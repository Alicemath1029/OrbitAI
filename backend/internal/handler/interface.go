package handler

import (
	"github.com/gin-gonic/gin"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/raids-lab/orbit/internal/service"
	"github.com/raids-lab/orbit/pkg/aitaskctl"
	"github.com/raids-lab/orbit/pkg/crclient"
	"github.com/raids-lab/orbit/pkg/cronjob"
	"github.com/raids-lab/orbit/pkg/imageregistry"
	"github.com/raids-lab/orbit/pkg/monitor"
	"github.com/raids-lab/orbit/pkg/packer"
	"github.com/raids-lab/orbit/pkg/prequeuewatcher"
)

// Manager is the interface that wraps the basic methods for a handler manager.
type Manager interface {
	GetName() string
	RegisterPublic(group *gin.RouterGroup)
	RegisterProtected(group *gin.RouterGroup)
	RegisterAdmin(group *gin.RouterGroup)
}

// RegisterConfig is a struct that holds the configuration for a Manager.
type RegisterConfig struct {
	// Client is the controller-runtime client.
	Client client.Client

	// KubeConfig is the kubernetes client config.
	KubeConfig *rest.Config

	// KubeClient is the kubernetes client.
	KubeClient kubernetes.Interface

	// PrometheusClient is the prometheus client.
	PrometheusClient monitor.PrometheusInterface

	// AITaskCtrl is the aitask controller.
	AITaskCtrl aitaskctl.TaskControllerInterface

	// ImagePacker is the image packer.
	ImagePacker packer.ImagePackerInterface

	// ImageRegistry is the image registry.
	ImageRegistry imageregistry.ImageRegistryInterface

	// ServiceManager 用于创建 Service 和 Ingress
	ServiceManager crclient.ServiceManagerInterface

	CronJobManager  *cronjob.CronJobManager
	PrequeueWatcher *prequeuewatcher.PrequeueWatcher

	// services
	ConfigService      *service.ConfigService
	PrequeueService    *service.PrequeueService
	BillingService     *service.BillingService
	GpuAnalysisService *service.GpuAnalysisService
}

// Registers is a slice of Manager Init functions.
// Each Manager should register itself by appending its Init function to this slice.
var Registers = []func(config *RegisterConfig) Manager{}
