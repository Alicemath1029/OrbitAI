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
)

const (
	DefaultScannerMountPath = "/orbit"
	DefaultScannerPort      = "7330"

	scannerBackendService = "scanner-service"
)

type ServiceScanRequest struct {
	JobName       string `json:"jobName"`
	Framework     string `json:"framework"`
	CheckpointDir string `json:"checkpointDir"`
	StoragePath   string `json:"storagePath"`
}

type ServiceScanResponse struct {
	Items        []ServiceScanItem `json:"items"`
	LatestMarker string            `json:"latestMarker,omitempty"`
}

type ServiceScanItem struct {
	Name        string    `json:"name"`
	Path        string    `json:"path"`
	StoragePath string    `json:"storagePath"`
	Step        int64     `json:"step"`
	SizeBytes   int64     `json:"sizeBytes"`
	ModTime     time.Time `json:"modTime"`
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
		item, err := scanLocalCheckpoint(ctx, scanBase.checkpointDir, scanBase.storagePath, scanBase.basePath)
		if err != nil {
			return ServiceScanResponse{}, err
		}
		return ServiceScanResponse{Items: []ServiceScanItem{item}}, nil
	}

	return scanLocalCheckpointDir(ctx, req.Framework, scanBase)
}

type localScanBase struct {
	basePath      string
	storagePath   string
	checkpointDir string
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
	return localScanBase{basePath: base, storagePath: storagePath, checkpointDir: checkpointDir}, nil
}

func scanLocalCheckpoint(ctx context.Context, checkpointDir, storagePath, base string) (ServiceScanItem, error) {
	size, modTime, err := scanLocalTree(ctx, base)
	if err != nil {
		return ServiceScanItem{}, err
	}
	name := filepath.Base(base)
	return ServiceScanItem{
		Name:        name,
		Path:        checkpointPath(checkpointDir, name, false),
		StoragePath: storagePath,
		Step:        stepFromName(name),
		SizeBytes:   size,
		ModTime:     modTime,
	}, nil
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
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return ServiceScanResponse{}, err
		}
		name := entry.Name()
		if shouldSkipCheckpointChild(name) {
			continue
		}
		childInfo, err := entry.Info()
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return ServiceScanResponse{}, err
		}
		if !looksLikeCheckpointEntry(framework, name, childInfo.IsDir()) {
			continue
		}
		childPath := filepath.Join(scanBase.basePath, name)
		size, modTime, err := scanLocalTree(ctx, childPath)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return ServiceScanResponse{}, err
		}
		if modTime.IsZero() {
			modTime = childInfo.ModTime()
		}
		items = append(items, ServiceScanItem{
			Name:        name,
			Path:        checkpointPath(scanBase.checkpointDir, name, true),
			StoragePath: filepath.ToSlash(filepath.Join(scanBase.storagePath, name)),
			Step:        stepFromName(name),
			SizeBytes:   size,
			ModTime:     modTime,
		})
	}
	return ServiceScanResponse{Items: items, LatestMarker: latestMarker}, nil
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
	case FrameworkPytorch, FrameworkLightning:
		return !isDir && hasCheckpointFileExt(name)
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
