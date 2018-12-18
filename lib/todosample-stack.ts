import cdk = require('@aws-cdk/cdk');
import ec2 = require('@aws-cdk/aws-ec2');
import ecs = require('@aws-cdk/aws-ecs');
import ecr = require('@aws-cdk/aws-ecr');
import elbv2 = require('@aws-cdk/aws-elasticloadbalancingv2');
import logs = require('@aws-cdk/aws-logs');

import { cloudformation as sdcfn } from '@aws-cdk/aws-servicediscovery'
import { DeletionPolicy } from '@aws-cdk/cdk';

export class TodosampleStack extends cdk.Stack {
  constructor(parent: cdk.App, name: string, props?: cdk.StackProps) {
    super(parent, name, props);
    
    // The code that defines your stack goes here
    
    const testVpc = {
      vpcId: 'vpc-xxxxxxxx',
      availabilityZones: [ 'ap-northeast-1a', 'ap-northeast-1c' ],
      publicSubnetIds: [ 'subnet-xxxxxxxx', 'subnet-xxxxxxxx' ],
      privateSubnetIds: [ 'subnet-xxxxxxxx', 'subnet-xxxxxxxx' ]
    }
    
    const securityGroup = ec2.SecurityGroupRef.import(this, 'BaseSecurityGroup', {
      securityGroupId: 'sg-xxxxxxxxxxxxxxxxxx'
    })
    
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: 'ecs/todocdk',
      retentionDays: 14,
      retainLogGroup: false
    })
    
    const logDriver = new ecs.AwsLogDriver(this, 'LogDriver', {
      logGroup: logGroup,
      streamPrefix: 'ecs',
    })
    
    const vpc = ec2.VpcNetwork.import(this, 'ExternalVpc', testVpc);
    
    const capitalize = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)
    
    const generateId = (s: string) => capitalize(s.replace(/[^A-Za-z0-9]/g, ''))
    
    const privateDnsNamespace = new sdcfn.PrivateDnsNamespaceResource(this, 'PrivateDnsNamespace', {
      name: 'todocdk',
      vpc: vpc.vpcId,
    })
    
    const addServiceDiscovery = (service: ecs.Ec2Service, name: string) => {
      const serviceDiscovery = new sdcfn.ServiceResource(this, `${generateId(name)}ServiceDiscovery`, {
        name,
        healthCheckCustomConfig: {
          failureThreshold: 1,
        },
        dnsConfig: {
          namespaceId: privateDnsNamespace.privateDnsNamespaceId,
          dnsRecords: [
            {
              type: 'A',
              ttl: '60',
            },
          ],
        },
      })
      
      const serviceResource = service.findChild('Service') as ecs.cloudformation.ServiceResource
      serviceResource.addPropertyOverride('ServiceRegistries', [{
        RegistryArn: serviceDiscovery.serviceArn,
      }])
      
      serviceResource.options.deletionPolicy = DeletionPolicy.Delete //消えないので
    }
    
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
    
    cluster.addDefaultAutoScalingGroupCapacity({
      instanceType: new ec2.InstanceType("t2.xlarge"),
      instanceCount: 4,
    }); 
        
    const apiTaskDef = new ecs.Ec2TaskDefinition(this, 'ApiTaskDef', {networkMode: ecs.NetworkMode.AwsVpc});
    
    const getImageByName = (name: string) => {
      const apiImage = ecr.Repository.import(this, `${generateId(name)}ImageFromEcr`, {repositoryName: name})
      return ecs.ContainerImage.fromEcrRepository(apiImage)
    }
    
    apiTaskDef.addContainer('api', {
      image: getImageByName('ch04/todoapi'),
      memoryLimitMiB: 512,
      environment: {
        TODO_BIND: ':8080',
        TODO_MASTER_URL: 'gihyo:gihyo@tcp(xxx.rds.amazonaws.com:3306)/tododb?parseTime=true',
        TODO_SLAVE_URL: 'gihyo:gihyo@tcp(yyy.rds.amazonaws.com:3306)/tododb?parseTime=true',
      },
      logging: logDriver,
    });
    
    const apiService = new ecs.Ec2Service(this, 'ApiService', {
      cluster,
      securityGroup,
      taskDefinition: apiTaskDef,
      healthCheckGracePeriodSeconds: 300,
    })
    
    addServiceDiscovery(apiService, 'api')
    
    /*
    api nginx
    */
    
    const apiNginxTaskDef = new ecs.Ec2TaskDefinition(this, 'ApiNginxTaskDef', {networkMode: ecs.NetworkMode.AwsVpc});
    
    apiNginxTaskDef.addContainer('api', {
      image: getImageByName('ch04/nginx'),
      memoryLimitMiB: 512,
      environment: {
        BACKEND_FAIL_TIMEOUT: '10s',
        BACKEND_HOST: 'api.todocdk:8080',
        BACKEND_MAX_FAILS: '3',
        GZIP: 'on',
        KEEPALIVE_TIMEOUT: '65',
        LOG_STDOUT: 'true',
        SERVER_NAME: 'api-nginx.todocdk',
        SERVER_PORT: '80',
        WORKER_CONNECTIONS: '1024',
        WORKER_PROCESSES: '2'
      },
      logging: logDriver,
    });
    
    const apiNginxService = new ecs.Ec2Service(this, 'ApiNginxService', {
      cluster,
      securityGroup,
      taskDefinition: apiNginxTaskDef,
      healthCheckGracePeriodSeconds: 300,
    })
    
    addServiceDiscovery(apiNginxService, 'api-nginx')
    
    /*
    web
    */
    
    const webTaskDef = new ecs.Ec2TaskDefinition(this, 'WebTaskDef', {
      networkMode: ecs.NetworkMode.AwsVpc
    });
    
    const webTaskDefResource = webTaskDef.findChild('Resource') as ecs.cloudformation.TaskDefinitionResource
    
    webTaskDefResource.addPropertyOverride('Volumes', [
      {
        Name: 'assets',
        DockerVolumeConfiguration: {
          Driver: 'local',
          Scope: 'task',
        },
      },
    ])
    
    const nginxNuxtContainer = webTaskDef.addContainer('nginx-nuxt', {
      image: getImageByName('ch04/nginx-nuxt'),
      memoryLimitMiB: 512,
      environment: {
        BACKEND_FAIL_TIMEOUT: '10s',
        BACKEND_HOST: 'localhost:3000',
        BACKEND_MAX_FAILS: '3',
        GZIP: 'on',
        KEEPALIVE_TIMEOUT: '65',
        LOG_STDOUT: 'true',
        SERVER_NAME: 'localhost',
        SERVER_PORT: '80',
        SERVICE_PORTS: '80',
        WORKER_CONNECTIONS: '1024',
        WORKER_PROCESSES: '2'
      },
      logging: logDriver,
    });
    
    nginxNuxtContainer.addPortMappings({
      containerPort: 80
    })
    
    nginxNuxtContainer.addMountPoints({
      containerPath: '/var/www/_nuxt',
      sourceVolume: 'assets',
      readOnly: false
    })
    
    const webContainer = webTaskDef.addContainer('web', {
      image: getImageByName('ch04/web'),
      memoryLimitMiB: 512,
      environment: {
        TODO_API_URL: 'http://api-nginx.todocdk',
      },
      logging: logDriver,
    });
    
    webContainer.addMountPoints({
      containerPath: '/todoweb/.nuxt/dist',
      sourceVolume: 'assets',
      readOnly: false
    })
    
    const webService = new ecs.Ec2Service(this, 'WebService', {
      cluster,
      securityGroup,
      taskDefinition: webTaskDef,
      healthCheckGracePeriodSeconds: 300,
    })
    
    addServiceDiscovery(webService, 'web')

    /*
    alb
    */
    
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      loadBalancerName: 'todo',
      vpc: vpc,
      internetFacing: true,
    });
    const listener = alb.addListener('Listener', {
      port: 80,
      open: true,
    });
    listener.addTargets('ApplicationTarget', {
      targetGroupName: 'todotarget',
      protocol: elbv2.ApplicationProtocol.Http,
      port: 80,
      targets: [webService],
      deregistrationDelaySec: 30,
    });
    
    new cdk.Output(this, 'LoadBalancerDNS', { value: alb.dnsName });
  }
}
