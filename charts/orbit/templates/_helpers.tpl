{{/*
Generate the url of grafana proxy
*/}}
{{- define "orbit.grafanaProxyURL" -}}
{{- $protocol := .Values.protocol -}}
{{- $host := .Values.grafanaProxy.host -}}
{{- printf "%s://%s" $protocol $host -}}
{{- end -}}

{{/*
Process grafana URLs by concatenating baseURL with paths
*/}}
{{- define "orbit.processGrafanaURLs" -}}
{{- $baseURL := include "orbit.grafanaProxyURL" . -}}
{{- $grafanaConfig := .Values.frontendConfig.grafana -}}
{{- $result := dict -}}
{{- range $key, $value := $grafanaConfig -}}
  {{- if ne $key "baseURL" -}}
    {{- if kindIs "map" $value -}}
      {{- $nestedResult := dict -}}
      {{- range $nestedKey, $nestedValue := $value -}}
        {{- $_ := set $nestedResult $nestedKey (printf "%s%s" $baseURL $nestedValue) -}}
      {{- end -}}
      {{- $_ := set $result $key $nestedResult -}}
    {{- else -}}
      {{- $_ := set $result $key (printf "%s%s" $baseURL $value) -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- $result | toJson -}}
{{- end -}}

{{/*
Generate the complete frontend config with processed grafana URLs
*/}}
{{- define "orbit.frontendConfig" -}}
{{- $config := deepCopy .Values.frontendConfig -}}
{{- $grafanaURLs := include "orbit.processGrafanaURLs" . | fromJson -}}
{{- $_ := set $config "grafana" $grafanaURLs -}}
{{- $config | toJson -}}
{{- end -}}

{{/*
Generate the url of main project
*/}}
{{- define "orbit.mainURL" -}}
{{- $protocol := .Values.protocol -}}
{{- $host := .Values.host -}}
{{- printf "%s://%s" $protocol $host -}}
{{- end -}}

{{/*
Generate dockerconfigjson
*/}}
{{- define "dockerconfigjson" -}}
{{- $registry := .Values.backendConfig.registry.harbor.server -}}
{{- $username := .Values.backendConfig.registry.harbor.user -}}
{{- $password := .Values.backendConfig.registry.harbor.password -}}
{{- printf "{\"auths\":{\"%s\":{\"username\":\"%s\",\"password\":\"%s\",\"auth\":\"%s\"}}}" $registry $username $password (printf "%s:%s" $username $password | b64enc) | b64enc -}}
{{- end -}}

{{/*
Generate backend config with images from top-level images section
*/}}
{{- define "orbit.backendConfig" -}}
{{- $config := deepCopy .Values.backendConfig -}}
{{- if $config.registry.enable -}}
  {{- $buildTools := $config.registry.buildTools -}}
  {{- $_ := set $buildTools "images" (dict 
    "buildx" (printf "%s:%s" .Values.images.buildx.repository .Values.images.buildx.tag)
    "nerdctl" (printf "%s:%s" .Values.images.nerdctl.repository .Values.images.nerdctl.tag)
    "envd" (printf "%s:%s" .Values.images.envd.repository .Values.images.envd.tag)
  ) -}}
  {{- $_ := set $config.registry "buildTools" $buildTools -}}
{{- end -}}
{{- $_ := set $config "host" .Values.host -}}
{{- $_ := set $config "namespaces" (dict "job" .Values.namespaces.job "image" .Values.namespaces.image) -}}
{{- if .Values.checkpointScanner.enabled -}}
  {{- $scanner := default (dict) $config.checkpointScanner -}}
  {{- if not $scanner.endpoint -}}
    {{- $_ := set $scanner "endpoint" (printf "http://checkpoint-scanner-service.%s.svc.cluster.local:%v" .Values.namespaces.job .Values.checkpointScanner.port) -}}
  {{- end -}}
  {{- $_ := set $config "checkpointScanner" $scanner -}}
{{- end -}}
{{- $checkpoint := default (dict) $config.checkpoint -}}
{{- $agent := default (dict) $checkpoint.agent -}}
{{- if not $agent.image -}}
  {{- $_ := set $agent "image" (printf "%s:%s" .Values.images.backend.repository .Values.images.backend.tag) -}}
{{- end -}}
{{- if not $agent.backendEndpoint -}}
  {{- $_ := set $agent "backendEndpoint" (printf "http://orbit-backend-svc.%s.svc.cluster.local:%s" .Release.Namespace (trimPrefix ":" .Values.backendConfig.port)) -}}
{{- end -}}
{{- $_ := set $agent "internalTokenSecretName" "orbit-checkpoint-internal-secret" -}}
{{- $_ := set $agent "internalTokenSecretKey" "token" -}}
{{- $_ := set $agent "internalToken" "" -}}
{{- $_ := set $checkpoint "agent" $agent -}}
{{- $_ := set $config "checkpoint" $checkpoint -}}
{{- $config | toYaml -}}
{{- end -}}

{{/*
Generate storage-server specific config with minimum required fields.
Avoid rendering full backend config into ss-config.
*/}}
{{- define "orbit.storageServerConfig" -}}
{{- $backend := .Values.backendConfig -}}
{{- $config := dict
  "host" .Values.host
  "port" $backend.port
  "namespaces" (dict "job" .Values.namespaces.job "image" .Values.namespaces.image)
  "postgres" $backend.postgres
  "storage" $backend.storage
  "secrets" $backend.secrets
  "auth" (dict
    "token" $backend.auth.token
    "ldap" (dict "enable" false)
    "normal" (dict "allowLogin" true "allowRegister" false)
  )
  "registry" (dict "enable" false)
  "smtp" (dict "enable" false)
-}}
{{- $config | toYaml -}}
{{- end -}}
