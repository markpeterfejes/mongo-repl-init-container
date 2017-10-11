# mongo-repl-init-container

This 'small' container let's your use mongodb as a Stateful Set in your kubernetes cluster. It will automatically find any other instances in the same namespace, if you have a headless service specified.

### Example kubernetes headless Service:

```json
{
    "apiVersion": "v1",
    "kind": "Service",
    "metadata": {
        "name": "mongo",
        "annotations": {
            "service.alpha.kubernetes.io/tolerate-unready-endpoints": "true"
        },
        "labels": {
            "app": "mongo"
        }
    },
    "spec": {
        "ports": [
            {
                "port": 27017,
                "name": "mongo-port"
            }
        ],
        "type": "ClusterIP",
        "clusterIP": "None",
        "selector": {
            "app": "mongo"
        }
    }
}
```

### Example kubernetes StatefulSet:

```json
{
    "apiVersion": "apps/v1beta1",
    "kind": "StatefulSet",
    "metadata": {
        "name": "mongodb"
    },
    "spec": {
        "serviceName": "mongo",
        "replicas": 3,
        "template": {
            "metadata": {
                "labels": {
                    "app": "mongo"
                }
            },
            "spec": {
                "initContainers": [
                    {
                        "name": "mongo-init",
                        "image": "markpeterfejes/mongo-repl-init-container:latest",
                        "volumeMounts": [
                            {
                                "name": "mongo",
                                "mountPath": "/data/db"
                            },
                            {
                                "name": "mongod-config",
                                "mountPath": "/mongod-config"
                            },
                            {
                                "name": "workdir",
                                "mountPath": "/workdir"
                            }
                        ]
                    }
                ],
                "containers": [
                    {
                        "name": "mongo",
                        "image": "mongo:3.4.9",
                        "command": [
                            "mongod",
                            "--config",
                            "/mongod-config/mongod.conf"
                        ],
                        "ports": [
                            {
                                "containerPort": 27017,
                                "name": "mongo"
                            }
                        ],
                        "volumeMounts": [
                            {
                                "name": "mongo",
                                "mountPath": "/data/db"
                            },
                            {
                                "name": "mongod-config",
                                "mountPath": "/mongod-config"
                            },
                            {
                                "name": "workdir",
                                "mountPath": "/workdir"
                            }
                        ],
                        "readinessProbe": {
                            "exec": {
                                "command": [
                                    "bash",
                                    "/workdir/health-check.sh"
                                ]
                            },
                            "initialDelaySeconds": 5,
                            "timeoutSeconds": 1
                        },
                        "livenessProbe": {
                            "exec": {
                                "command": [
                                    "bash",
                                    "/workdir/health-check.sh"
                                ]
                            },
                            "initialDelaySeconds": 30,
                            "periodSeconds": 10,
                            "timeoutSeconds": 2
                        }
                    }
                ],
                "volumes": [
                    {
                        "name": "mongod-config",
                        "configMap": {
                            "name": "mongodb-config"
                        }
                    },
                    {
                        "name": "workdir",
                        "emptyDir": {
                            "medium": "Memory"
                        }
                    }
                ]
            }
        },
        "volumeClaimTemplates": [
            {
                "metadata": {
                    "name": "mongo"
                },
                "spec": {
                    "accessModes": [
                        "ReadWriteOnce"
                    ],
                    "resources": {
                        "requests": {
                            "storage": "50Gi"
                        }
                    }
                }
            }
        ]
    }
}
```
