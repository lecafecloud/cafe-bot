import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as docker from "@pulumi/docker";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const stack = pulumi.getStack();
const repositoryName = `${stack}-cafe-bot`;

const appConfig = new pulumi.Config();
const discordToken = appConfig.requireSecret("discordToken");
const clientId = appConfig.requireSecret("clientId");

const awsRegion = aws.config.requireRegion();

const botSecretJson = pulumi.secret(
    pulumi
        .all([discordToken, clientId])
        .apply(([token, id]) => JSON.stringify({ DISCORD_TOKEN: token, CLIENT_ID: id }))
);

const botSecret = new aws.secretsmanager.Secret("botSecret", {
    name: `${repositoryName}-env`,
});

new aws.secretsmanager.SecretVersion("botSecretValue", {
    secretId: botSecret.id,
    secretString: botSecretJson,
});

const botRepository = new aws.ecr.Repository("botRepository", {
    name: repositoryName,
    imageScanningConfiguration: { scanOnPush: true },
});

const ecrCredentials = aws.ecr.getAuthorizationTokenOutput({});

const botImage = new docker.Image("botImage", {
    build: {
        context: projectRoot,
        dockerfile: path.join(projectRoot, "Dockerfile"),
        platform: "linux/amd64",
        extraOptions: ["--progress=plain"],
    },
    imageName: pulumi.interpolate`${botRepository.repositoryUrl}:latest`,
    registry: pulumi.secret(
        ecrCredentials.apply(({ proxyEndpoint, userName, password }) => ({
            server: proxyEndpoint,
            username: userName,
            password,
        }))
    ),
});

const networkVpc = new aws.ec2.Vpc("networkVpc", {
    cidrBlock: "10.0.0.0/16",
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags: { Name: `${repositoryName}-vpc` },
});

const networkGateway = new aws.ec2.InternetGateway("networkGateway", {
    vpcId: networkVpc.id,
});

const publicSubnet = new aws.ec2.Subnet("publicSubnet", {
    vpcId: networkVpc.id,
    cidrBlock: "10.0.1.0/24",
    mapPublicIpOnLaunch: true,
    tags: { Name: `${repositoryName}-public-1` },
});

const networkRouteTable = new aws.ec2.RouteTable("networkRouteTable", {
    vpcId: networkVpc.id,
    tags: { Name: `${repositoryName}-public-rt` },
});

new aws.ec2.Route("networkRoute", {
    routeTableId: networkRouteTable.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: networkGateway.id,
});

const subnetAssociation = new aws.ec2.RouteTableAssociation("subnetRouteTableAssociation", {
    routeTableId: networkRouteTable.id,
    subnetId: publicSubnet.id,
});

const botSecurityGroup = new aws.ec2.SecurityGroup("botSecurityGroup", {
    description: "Allow outbound traffic for cafe bot",
    vpcId: networkVpc.id,
    egress: [
        {
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
});

const botCluster = new aws.ecs.Cluster("botCluster", {});

const botLogGroup = new aws.cloudwatch.LogGroup("botLogGroup", {
    name: `/aws/ecs/${repositoryName}`,
    retentionInDays: 14,
});

const botTaskExecutionRole = new aws.iam.Role("botTaskExecutionRole", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Principal: { Service: "ecs-tasks.amazonaws.com" },
                Action: "sts:AssumeRole",
            },
        ],
    }),
});

new aws.iam.RolePolicyAttachment("botTaskExecutionRolePolicy", {
    role: botTaskExecutionRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

new aws.iam.RolePolicy("botExecutionSecretPolicy", {
    role: botTaskExecutionRole.id,
    policy: botSecret.arn.apply((secretArn) =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: [
                        "secretsmanager:DescribeSecret",
                        "secretsmanager:GetSecretValue",
                    ],
                    Resource: `${secretArn}*`,
                },
            ],
        })
    ),
});

const botTaskRole = new aws.iam.Role("botTaskRole", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Principal: { Service: "ecs-tasks.amazonaws.com" },
                Action: "sts:AssumeRole",
            },
        ],
    }),
});

new aws.iam.RolePolicy("botTaskSecretPolicy", {
    role: botTaskRole.id,
    policy: botSecret.arn.apply((secretArn) =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: [
                        "secretsmanager:DescribeSecret",
                        "secretsmanager:GetSecretValue",
                    ],
                    Resource: `${secretArn}*`,
                },
            ],
        })
    ),
});

const containerDefinitions = pulumi
    .all([botSecret.arn, botImage.imageName, botLogGroup.name])
    .apply(([secretArn, imageName, logGroupName]) =>
        JSON.stringify([
            {
                name: "cafe-bot",
                image: imageName,
                essential: true,
                environment: [{ name: "NODE_ENV", value: "production" }],
                secrets: [
                    { name: "DISCORD_TOKEN", valueFrom: `${secretArn}:DISCORD_TOKEN::` },
                    { name: "CLIENT_ID", valueFrom: `${secretArn}:CLIENT_ID::` },
                ],
                logConfiguration: {
                    logDriver: "awslogs",
                    options: {
                        "awslogs-group": logGroupName,
                        "awslogs-region": awsRegion,
                        "awslogs-stream-prefix": "cafe-bot",
                    },
                },
            },
        ])
    );

const botTaskDefinition = new aws.ecs.TaskDefinition("botTaskDefinition", {
    family: repositoryName,
    requiresCompatibilities: ["FARGATE"],
    cpu: "256",
    memory: "512",
    networkMode: "awsvpc",
    executionRoleArn: botTaskExecutionRole.arn,
    taskRoleArn: botTaskRole.arn,
    runtimePlatform: {
        cpuArchitecture: "X86_64",
        operatingSystemFamily: "LINUX",
    },
    containerDefinitions,
});

const botService = new aws.ecs.Service(
    "botService",
    {
        name: repositoryName,
        cluster: botCluster.arn,
        taskDefinition: botTaskDefinition.arn,
        desiredCount: 1,
        launchType: "FARGATE",
        enableExecuteCommand: false,
        networkConfiguration: {
            assignPublicIp: true,
            subnets: [publicSubnet.id],
            securityGroups: [botSecurityGroup.id],
        },
    },
    {
        dependsOn: [subnetAssociation],
    }
);

export const serviceName = botService.name;
export const repositoryUrl = botRepository.repositoryUrl;
export const secretName = botSecret.name;
