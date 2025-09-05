# Kubernetes Objects Reference

## Daily Use (每天都會用到)
```
Pod          - 最小部署單位
Deployment   - 應用程式管理 
Service      - 服務暴露
ConfigMap    - 配置檔案
Secret       - 密碼/憑證
Ingress      - 外部流量路由
Namespace    - 資源隔離
```

## Weekly Use (每週會用到)
```
StatefulSet  - 資料庫等有狀態應用
PVC/PV       - 持久化儲存
Job          - 一次性任務
HPA          - 自動擴縮容
ReplicaSet   - Pod 副本管理 (通常被 Deployment 管理)
```

## Monthly Use (偶爾會用到)
```
CronJob           - 定時任務
DaemonSet         - 每個節點跑一個 Pod
NetworkPolicy     - 網路安全規則
ServiceAccount    - 服務身份認證
LimitRange        - 資源限制
ResourceQuota     - 資源配額
```

## Advanced Use (進階功能)
```
Role/ClusterRole                - 權限定義
RoleBinding/ClusterRoleBinding  - 權限綁定
PodDisruptionBudget            - 高可用性保護
StorageClass                   - 儲存類別
EndpointSlice                  - 服務端點
CRD                           - 自定義資源
PodSecurityPolicy             - Pod 安全策略
```

## 完整物件清單
```
Workloads:     Pod, Deployment, ReplicaSet, StatefulSet, DaemonSet, Job, CronJob
Network:       Service, Ingress, NetworkPolicy, EndpointSlice
Config:        ConfigMap, Secret
Storage:       PersistentVolume, PersistentVolumeClaim, StorageClass
Security:      ServiceAccount, Role, ClusterRole, RoleBinding, ClusterRoleBinding
Scaling:       HorizontalPodAutoscaler, VerticalPodAutoscaler, PodDisruptionBudget
Resources:     LimitRange, ResourceQuota
Advanced:      CustomResourceDefinition, MutatingAdmissionWebhook, ValidatingAdmissionWebhook
```

## kubecmds-viz 支援規劃

### 已實作
```
General     - 基本查看指令
Deployment  - 部署管理
Pod         - Pod 操作 (logs, describe, exec)
```

### 計劃新增
```
Service     - 服務發現、端點、port-forward
Storage     - PVC/PV 狀態
Security    - RBAC、權限
Scaling     - HPA 狀態、手動擴容
Job         - 任務狀態、定時任務
Network     - Ingress 規則、網路策略
Admin       - 節點狀態、資源配額
```