package internal

import (
	"k8s.io/klog/v2"

	"github.com/raids-lab/orbit/internal/handler"
	_ "github.com/raids-lab/orbit/internal/handler/aijob"
	_ "github.com/raids-lab/orbit/internal/handler/image"
	_ "github.com/raids-lab/orbit/internal/handler/operations"
	_ "github.com/raids-lab/orbit/internal/handler/spjob"
	_ "github.com/raids-lab/orbit/internal/handler/tool"
	_ "github.com/raids-lab/orbit/internal/handler/vcjob"
)

// registerManagers registers all the managers.
func registerManagers(config *handler.RegisterConfig) []handler.Manager {
	var managers []handler.Manager
	for _, register := range handler.Registers {
		manager := register(config)
		managers = append(managers, manager)
		klog.Infof("Registered manager: %s", manager.GetName())
	}
	return managers
}
