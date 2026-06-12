package checkpoint

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gorm.io/datatypes"

	"github.com/raids-lab/orbit/dao/model"
)

const (
	DefaultScannerMountPath = "/orbit"
	DefaultScannerPort      = "7330"

	scannerBackendService = "scanner-service"
)

type ServiceScanRequest struct {
	JobName       string `json:"jobName"`
	RunID         *uint  `json:"runID,omitempty"`
	Framework     string `json:"framework"`
	CheckpointDir string `json:"checkpointDir"`
	StoragePath   string `json:"storagePath"`
}

type ServiceScanResponse struct {
	Items        []ServiceScanItem `json:"items"`
	LatestMarker string            `json:"latestMarker,omitempty"`
}

type ServiceDeleteRequest struct {
	StoragePath string `json:"storagePath"`
	Name        string `json:"name,omitempty"`
	Path        string `json:"path,omitempty"`
	Step        *int64 `json:"step,omitempty"`
}

type ServiceDeleteResponse struct {
	Deleted []string `json:"deleted"`
}

type ServiceScanItem struct {
	Name                string            `json:"name"`
	Path                string            `json:"path"`
	StoragePath         string            `json:"storagePath"`
	Framework           string            `json:"framework,omitempty"`
	Step                int64             `json:"step"`
	SizeBytes           int64             `json:"sizeBytes"`
	ModTime             time.Time         `json:"modTime"`
	Status              string            `json:"status,omitempty"`
	Metadata            datatypes.JSONMap `json:"metadata,omitempty"`
	ManifestStoragePath string            `json:"manifestStoragePath,omitempty"`
}

func ValidateServiceScanRequest(req ServiceScanRequest) error {
	if strings.TrimSpace(req.StoragePath) == "" {
		return errors.New("storagePath is required")
	}
	if strings.TrimSpace(req.CheckpointDir) == "" {
		return errors.New("checkpointDir is required")
	}
	return nil
}

func ValidateServiceDeleteRequest(req ServiceDeleteRequest) error {
	if strings.TrimSpace(req.StoragePath) == "" {
		return errors.New("storagePath is required")
	}
	return nil
}

type FileSystemScanner struct {
	Root string
}

func NewFileSystemScanner(root string) FileSystemScanner {
	root = strings.TrimSpace(root)
	if root == "" {
		root = DefaultScannerMountPath
	}
	return FileSystemScanner{Root: root}
}

func (s FileSystemScanner) Scan(ctx context.Context, req ServiceScanRequest) (ServiceScanResponse, error) {
	scanBase, err := s.resolveBase(req)
	if err != nil {
		return ServiceScanResponse{}, err
	}
	info, err := os.Stat(scanBase.basePath)
	if err != nil {
		return ServiceScanResponse{}, fmt.Errorf("checkpoint directory is not accessible: %w", err)
	}

	if !info.IsDir() {
		item, err := scanLocalCheckpoint(ctx, scanBase)
		if err != nil {
			return ServiceScanResponse{}, err
		}
		return ServiceScanResponse{Items: []ServiceScanItem{item}}, nil
	}

	return scanLocalCheckpointDir(ctx, req.Framework, scanBase)
}

func (s FileSystemScanner) Delete(ctx context.Context, req ServiceDeleteRequest) (ServiceDeleteResponse, error) {
	targetPath, storagePath, err := s.resolveStoragePath(req.StoragePath)
	if err != nil {
		return ServiceDeleteResponse{}, err
	}
	info, statErr := os.Stat(targetPath)
	isDir := statErr == nil && info.IsDir()
	markerItem := deleteMarkerItem(req, storagePath)
	applyManifestToDeleteMarkerItem(&markerItem, targetPath)

	deleted := make([]string, 0, 3)
	if err := removeLocalPath(targetPath); err != nil {
		return ServiceDeleteResponse{}, err
	}
	deleted = append(deleted, storagePath)

	manifestStoragePath := manifestPathForCheckpoint(storagePath)
	manifestPath, _, err := s.resolveStoragePath(manifestStoragePath)
	if err != nil {
		return ServiceDeleteResponse{}, err
	}
	if err := removeLocalPath(manifestPath); err != nil {
		return ServiceDeleteResponse{}, err
	}
	deleted = append(deleted, manifestStoragePath)

	successMarkerStoragePath := successMarkerPathForCheckpoint(storagePath, isDir)
	successMarkerPath, _, err := s.resolveStoragePath(successMarkerStoragePath)
	if err != nil {
		return ServiceDeleteResponse{}, err
	}
	if err := removeLocalPath(successMarkerPath); err != nil {
		return ServiceDeleteResponse{}, err
	}
	deleted = append(deleted, successMarkerStoragePath)

	if err := s.removeMatchingLatestMarker(storagePath, &markerItem); err != nil {
		return ServiceDeleteResponse{}, err
	}
	return ServiceDeleteResponse{Deleted: deleted}, ctx.Err()
}

type localScanBase struct {
	basePath      string
	storagePath   string
	checkpointDir string
	jobName       string
	runID         *uint
}

func (s FileSystemScanner) resolveBase(req ServiceScanRequest) (localScanBase, error) {
	root := filepath.Clean(strings.TrimSpace(s.Root))
	if root == "" || !filepath.IsAbs(root) {
		return localScanBase{}, fmt.Errorf("scanner root %q must be absolute", s.Root)
	}
	storagePath := cleanStoragePath(req.StoragePath)
	if storagePath == "" {
		return localScanBase{}, errors.New("storagePath is required")
	}
	checkpointDir := filepath.ToSlash(filepath.Clean(strings.TrimSpace(req.CheckpointDir)))
	if checkpointDir == "." {
		checkpointDir = ""
	}

	base := filepath.Join(root, filepath.FromSlash(storagePath))
	if !isPathUnderOrEqual(base, root) {
		return localScanBase{}, fmt.Errorf("storagePath %q escapes scanner root", req.StoragePath)
	}
	return localScanBase{
		basePath:      base,
		storagePath:   storagePath,
		checkpointDir: checkpointDir,
		jobName:       strings.TrimSpace(req.JobName),
		runID:         req.RunID,
	}, nil
}

func (s FileSystemScanner) resolveStoragePath(raw string) (absolutePath, storagePath string, err error) {
	root := filepath.Clean(strings.TrimSpace(s.Root))
	if root == "" || !filepath.IsAbs(root) {
		return "", "", fmt.Errorf("scanner root %q must be absolute", s.Root)
	}
	storagePath = cleanStoragePath(raw)
	if storagePath == "" {
		return "", "", errors.New("storagePath is required")
	}
	absolutePath = filepath.Join(root, filepath.FromSlash(storagePath))
	if !isPathUnderOrEqual(absolutePath, root) {
		return "", "", fmt.Errorf("storagePath %q escapes scanner root", raw)
	}
	return absolutePath, storagePath, nil
}

func (s FileSystemScanner) removeMatchingLatestMarker(storagePath string, item *model.JobCheckpoint) error {
	root := filepath.Clean(strings.TrimSpace(s.Root))
	markerPath := filepath.Join(root, filepath.Dir(filepath.FromSlash(storagePath)), latestCheckpointTracker)
	marker, err := os.ReadFile(markerPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if checkpointMatchesTracker(item, strings.TrimSpace(string(marker)), latestMarkerStep(string(marker))) {
		if err := removeLocalPath(markerPath); err != nil {
			return err
		}
	}
	return nil
}

func deleteMarkerItem(req ServiceDeleteRequest, storagePath string) model.JobCheckpoint {
	step := stepFromName(filepath.Base(storagePath))
	if req.Step != nil {
		step = *req.Step
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = filepath.Base(storagePath)
	}
	path := strings.TrimSpace(req.Path)
	if path == "" {
		path = storagePath
	}
	return model.JobCheckpoint{
		Name:        name,
		Path:        filepath.ToSlash(filepath.Clean(path)),
		StoragePath: storagePath,
		Step:        step,
	}
}

func applyManifestToDeleteMarkerItem(item *model.JobCheckpoint, checkpointPath string) {
	data, err := os.ReadFile(manifestPathForCheckpoint(checkpointPath))
	if err != nil {
		return
	}
	manifest, err := parseCheckpointManifest(data)
	if err != nil {
		return
	}
	applyManifestToCheckpoint(item, manifest, "")
}

func removeLocalPath(path string) error {
	if err := os.RemoveAll(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	return nil
}

func scanLocalCheckpoint(ctx context.Context, scanBase localScanBase) (ServiceScanItem, error) {
	size, modTime, err := scanLocalTree(ctx, scanBase.basePath)
	if err != nil {
		return ServiceScanItem{}, err
	}
	stat, err := os.Stat(scanBase.basePath)
	if err != nil {
		return ServiceScanItem{}, err
	}
	name := filepath.Base(scanBase.basePath)
	item := ServiceScanItem{
		Name:        name,
		Path:        checkpointPath(scanBase.checkpointDir, name, false),
		StoragePath: scanBase.storagePath,
		Step:        stepFromName(name),
		SizeBytes:   size,
		ModTime:     modTime,
	}
	applyLocalManifestToScanItem(ctx, &item, scanBase.basePath, manifestPathForCheckpoint(scanBase.storagePath), manifestValidationTarget{
		ActualSize:    size,
		FilePath:      scanBase.basePath,
		JobName:       scanBase.jobName,
		RunID:         scanBase.runID,
		SuccessMarker: localSuccessMarkerExists(scanBase.basePath, stat.IsDir()),
	})
	return item, nil
}

func scanLocalCheckpointDir(ctx context.Context, framework string, scanBase localScanBase) (ServiceScanResponse, error) {
	entries, err := os.ReadDir(scanBase.basePath)
	if err != nil {
		return ServiceScanResponse{}, err
	}
	latestMarker := readLatestCheckpointMarker(scanBase.basePath)
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	items := make([]ServiceScanItem, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		item, ok, err := scanLocalCheckpointEntry(ctx, framework, scanBase, entry, seen)
		if err != nil {
			return ServiceScanResponse{}, err
		}
		if ok {
			items = append(items, item)
		}
	}
	return ServiceScanResponse{Items: items, LatestMarker: latestMarker}, nil
}

func scanLocalCheckpointEntry(
	ctx context.Context,
	framework string,
	scanBase localScanBase,
	entry os.DirEntry,
	seen map[string]struct{},
) (ServiceScanItem, bool, error) {
	if err := ctx.Err(); err != nil {
		return ServiceScanItem{}, false, err
	}
	name := entry.Name()
	if strings.HasSuffix(name, checkpointManifestSuffix) {
		return scanLocalManifestEntry(ctx, scanBase, strings.TrimSuffix(name, checkpointManifestSuffix), seen)
	}
	if shouldSkipCheckpointChild(name) {
		return ServiceScanItem{}, false, nil
	}
	childInfo, err := entry.Info()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ServiceScanItem{}, false, nil
		}
		return ServiceScanItem{}, false, err
	}
	if !looksLikeCheckpointEntry(framework, name, childInfo.IsDir()) || checkpointEntrySeen(seen, name) {
		return ServiceScanItem{}, false, nil
	}
	return scanLocalCheckpointEntryByName(ctx, scanBase, name, seen)
}

func scanLocalManifestEntry(
	ctx context.Context,
	scanBase localScanBase,
	targetName string,
	seen map[string]struct{},
) (ServiceScanItem, bool, error) {
	if targetName == "" || checkpointEntrySeen(seen, targetName) {
		return ServiceScanItem{}, false, nil
	}
	return scanLocalCheckpointEntryByName(ctx, scanBase, targetName, seen)
}

func scanLocalCheckpointEntryByName(
	ctx context.Context,
	scanBase localScanBase,
	name string,
	seen map[string]struct{},
) (ServiceScanItem, bool, error) {
	item, err := scanLocalCheckpointChild(ctx, scanBase, name)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ServiceScanItem{}, false, nil
		}
		return ServiceScanItem{}, false, err
	}
	seen[name] = struct{}{}
	return item, true, nil
}

func checkpointEntrySeen(seen map[string]struct{}, name string) bool {
	_, ok := seen[name]
	return ok
}

func scanLocalCheckpointChild(ctx context.Context, scanBase localScanBase, name string) (ServiceScanItem, error) {
	childPath := filepath.Join(scanBase.basePath, name)
	childInfo, err := os.Stat(childPath)
	if err != nil {
		return ServiceScanItem{}, err
	}
	size, modTime, err := scanLocalTree(ctx, childPath)
	if err != nil {
		return ServiceScanItem{}, err
	}
	if modTime.IsZero() {
		modTime = childInfo.ModTime()
	}
	item := ServiceScanItem{
		Name:        name,
		Path:        checkpointPath(scanBase.checkpointDir, name, true),
		StoragePath: filepath.ToSlash(filepath.Join(scanBase.storagePath, name)),
		Step:        stepFromName(name),
		SizeBytes:   size,
		ModTime:     modTime,
	}
	applyLocalManifestToScanItem(
		ctx,
		&item,
		childPath,
		manifestPathForCheckpoint(filepath.ToSlash(filepath.Join(scanBase.storagePath, name))),
		manifestValidationTarget{
			ActualSize:    size,
			FilePath:      childPath,
			JobName:       scanBase.jobName,
			RunID:         scanBase.runID,
			SuccessMarker: localSuccessMarkerExists(childPath, childInfo.IsDir()),
		},
	)
	return item, nil
}

func applyLocalManifestToScanItem(
	ctx context.Context,
	item *ServiceScanItem,
	checkpointPath string,
	manifestStoragePath string,
	target manifestValidationTarget,
) {
	manifestPath := manifestPathForCheckpoint(checkpointPath)
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		markScanItemInvalid(item, manifestStoragePath, fmt.Sprintf("manifest schemaVersion %s is required", checkpointManifestSchemaV2))
		return
	}
	manifest, err := parseCheckpointManifest(data)
	if err != nil {
		markScanItemInvalid(item, manifestStoragePath, fmt.Sprintf("manifest parse failed: %v", err))
		return
	}
	if name := strings.TrimSpace(manifest.Name); name != "" {
		item.Name = name
	}
	if path := strings.TrimSpace(manifest.Path); path != "" {
		item.Path = filepath.ToSlash(filepath.Clean(path))
	}
	if framework := strings.TrimSpace(manifest.Framework); framework != "" {
		item.Framework = strings.ToLower(framework)
	}
	if manifest.Step != nil {
		item.Step = *manifest.Step
	}
	if manifest.SizeBytes != nil && item.SizeBytes == 0 {
		item.SizeBytes = *manifest.SizeBytes
	}
	if manifest.Status != "" {
		item.Status = string(manifest.Status)
	}
	if storagePath := strings.TrimSpace(manifest.StoragePath); storagePath != "" {
		item.StoragePath = filepath.ToSlash(filepath.Clean(storagePath))
	}
	item.Metadata = mergeManifestMetadata(item.Metadata, manifest, manifestStoragePath)
	item.ManifestStoragePath = manifestStoragePath
	if issues := validateCheckpointManifest(ctx, manifest, target); len(issues) > 0 {
		markScanItemInvalid(item, manifestStoragePath, issues...)
	} else if item.Metadata != nil {
		item.Metadata[checkpointValidationStatusKey] = checkpointValidationValid
	}
}

func localSuccessMarkerExists(checkpointPath string, isDir bool) bool {
	_, err := os.Stat(successMarkerPathForCheckpoint(checkpointPath, isDir))
	return err == nil
}

func markScanItemInvalid(item *ServiceScanItem, manifestStoragePath string, issues ...string) {
	if item == nil {
		return
	}
	if item.Metadata == nil {
		item.Metadata = datatypes.JSONMap{}
	}
	item.Status = string(model.JobCheckpointStatusInvalid)
	item.Metadata[checkpointValidationStatusKey] = checkpointValidationInvalid
	item.Metadata[checkpointValidationErrorsKey] = issues
	if manifestStoragePath != "" {
		item.Metadata["manifestStoragePath"] = filepath.ToSlash(filepath.Clean(manifestStoragePath))
	}
}

func readLatestCheckpointMarker(base string) string {
	data, err := os.ReadFile(filepath.Join(base, latestCheckpointTracker))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func cleanStoragePath(raw string) string {
	normalized := strings.ReplaceAll(strings.TrimSpace(raw), "\\", "/")
	normalized = strings.TrimLeft(normalized, "/")
	cleaned := filepath.ToSlash(filepath.Clean(normalized))
	if cleaned == "." {
		return ""
	}
	return cleaned
}

func checkpointPath(checkpointDir, name string, joinName bool) string {
	checkpointDir = filepath.ToSlash(filepath.Clean(strings.TrimSpace(checkpointDir)))
	if checkpointDir == "." {
		checkpointDir = ""
	}
	if !joinName {
		if checkpointDir != "" {
			return checkpointDir
		}
		return "/" + name
	}
	if checkpointDir == "" {
		return "/" + name
	}
	return filepath.ToSlash(filepath.Join(checkpointDir, name))
}

func looksLikeCheckpointEntry(framework, name string, isDir bool) bool {
	if stepFromName(name) >= 0 {
		return true
	}
	switch strings.ToLower(framework) {
	case FrameworkPytorch, FrameworkLightning, FrameworkFSDP:
		return !isDir && hasCheckpointFileExt(name)
	case FrameworkTensorFlow, FrameworkJAX:
		return isDir || hasCheckpointFileExt(name) || strings.HasSuffix(name, ".pkl")
	case FrameworkCustom:
		return isDir || hasCheckpointFileExt(name)
	default:
		return isDir
	}
}

func scanLocalTree(ctx context.Context, root string) (int64, time.Time, error) {
	info, err := os.Stat(root)
	if err != nil {
		return 0, time.Time{}, err
	}
	if !info.IsDir() {
		return info.Size(), info.ModTime(), nil
	}

	total := int64(0)
	newest := info.ModTime()
	err = filepath.WalkDir(root, func(_ string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.IsDir() {
			total += info.Size()
		}
		if info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		return nil
	})
	if err != nil {
		return 0, time.Time{}, err
	}
	return total, newest, nil
}

func ScannerHealthHandler(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}
