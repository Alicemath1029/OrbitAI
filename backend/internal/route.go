package internal

import (
	"net/http"

	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"

	docs "github.com/raids-lab/orbit/docs"
	"github.com/raids-lab/orbit/internal/handler"
	"github.com/raids-lab/orbit/internal/middleware"
	"github.com/raids-lab/orbit/pkg/constants"
)

type Backend struct {
	*gin.Engine
}

func Register(registerConfig *handler.RegisterConfig) *Backend {
	s := &Backend{gin.Default()}

	// Kubernetes health check
	s.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "ok",
		})
	})

	// Register custom routes
	s.RegisterService(registerConfig)

	// Swagger
	// todo: DisablingWrapHandler https://github.com/swaggo/gin-swagger/blob/master/swagger.go#L205
	docs.SwaggerInfo.BasePath = "/api"

	s.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	return s
}

func (b *Backend) RegisterService(conf *handler.RegisterConfig) {
	managers := registerManagers(conf)

	///////////////////////////////////////
	//// Public routers, no need login ////
	///////////////////////////////////////
	publicRouter := b.Group(constants.APIPrefix)
	for _, mgr := range managers {
		mgr.RegisterPublic(publicRouter.Group(mgr.GetName()))
	}

	/////////////////////////////////////////////////
	//// Public API v1 routers, custom auth only ////
	/////////////////////////////////////////////////
	publicV1Router := b.Group(constants.APIV1Prefix)
	for _, mgr := range managers {
		if publicV1Mgr, ok := mgr.(handler.PublicV1Manager); ok {
			publicV1Mgr.RegisterPublicV1(publicV1Router.Group(mgr.GetName()))
		}
	}

	///////////////////////////////////////
	//// Protected routers, need login ////
	///////////////////////////////////////
	protectedRouter := b.Group(constants.APIV1Prefix)
	protectedRouter.Use(middleware.AuthProtected())
	for _, mgr := range managers {
		mgr.RegisterProtected(protectedRouter.Group(mgr.GetName()))
	}

	///////////////////////////////////////
	//// Admin routers, need admin role ///
	///////////////////////////////////////
	adminRouter := b.Group(constants.APIV1AdminPrefix)
	adminRouter.Use(middleware.AuthProtected(), middleware.AuthAdmin())
	for _, mgr := range managers {
		mgr.RegisterAdmin(adminRouter.Group(mgr.GetName()))
	}
}
