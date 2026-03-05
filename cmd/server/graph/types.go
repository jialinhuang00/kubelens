// Package graph defines the K8s resource topology graph types and build logic.
// Mirrors shared/graph-types.ts and api/utils/graph-builder.ts.
package graph

// NodeKind is a K8s API resource kind name.
type NodeKind = string

// NodeCategory is our own grouping for visual styling.
type NodeCategory = string

// Edge relationship type constants.
const (
	EdgeUsesConfigMap      = "uses-configmap"
	EdgeUsesSecret         = "uses-secret"
	EdgeUsesPVC            = "uses-pvc"
	EdgeUsesServiceAccount = "uses-serviceaccount"
	EdgeExposes            = "exposes"
	EdgeRoutesTo           = "routes-to"
	EdgeParentGateway      = "parent-gateway"
	EdgeBindsRole          = "binds-role"
	EdgeOwns               = "owns"
)

// Source field path constants.
const (
	SFServiceAccountName = "spec.serviceAccountName"
	SFEnvFromConfigMap   = "envFrom.configMapRef"
	SFEnvFromSecret      = "envFrom.secretRef"
	SFEnvConfigMapKey    = "env.valueFrom.configMapKeyRef"
	SFEnvSecretKey       = "env.valueFrom.secretKeyRef"
	SFVolumePVC          = "volumes.persistentVolumeClaim"
	SFVolumeConfigMap    = "volumes.configMap"
	SFVolumeSecret       = "volumes.secret"
	SFProjectedConfigMap = "volumes.projected.configMap"
	SFProjectedSecret    = "volumes.projected.secret"
	SFSelector           = "spec.selector"
	SFParentRefs         = "spec.parentRefs"
	SFBackendRefs        = "spec.rules.backendRefs"
	SFIngressBackend     = "spec.rules.http.paths.backend"
	SFScaleTargetRef     = "spec.scaleTargetRef"
	SFRoleRef            = "roleRef"
	SFSubjects           = "subjects"
)

// Pod phase / display status values.
const (
	PodPending          = "Pending"
	PodRunning          = "Running"
	PodSucceeded        = "Succeeded"
	PodFailed           = "Failed"
	PodUnknown          = "Unknown"
	PodCrashLoopBackOff = "CrashLoopBackOff"
)

// GraphNode is a node in the K8s resource topology graph.
type GraphNode struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	Kind      NodeKind               `json:"kind"`
	Category  NodeCategory           `json:"category"`
	Namespace string                 `json:"namespace"`
	Metadata  map[string]interface{} `json:"metadata"`
}

// GraphEdge is a directed edge in the topology graph.
type GraphEdge struct {
	Source      string `json:"source"`
	Target      string `json:"target"`
	Type        string `json:"type"`
	SourceField string `json:"sourceField,omitempty"`
}

// PodNode extends GraphNode with typed pod metadata.
type PodNode struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	Kind      NodeKind               `json:"kind"`
	Category  NodeCategory           `json:"category"`
	Namespace string                 `json:"namespace"`
	Metadata  map[string]interface{} `json:"metadata"`
}

// GraphStats summarises the graph.
type GraphStats struct {
	TotalNodes     int            `json:"totalNodes"`
	TotalEdges     int            `json:"totalEdges"`
	ByKind         map[string]int `json:"byKind"`
	NamespaceCount int            `json:"namespaceCount"`
}

// GraphResult is the complete output of BuildGraph.
type GraphResult struct {
	Nodes      []GraphNode            `json:"nodes"`
	Edges      []GraphEdge            `json:"edges"`
	Pods       map[string][]PodNode   `json:"pods"`
	Namespaces []string               `json:"namespaces"`
	Stats      GraphStats             `json:"stats"`
}
