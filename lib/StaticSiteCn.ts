import * as cdk from 'aws-cdk-lib';
import {RemovalPolicy} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {env} from "process";
import * as fs from "fs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import {OriginAccessIdentity} from 'aws-cdk-lib/aws-cloudfront';
import {execSync} from "child_process";
import {Bucket} from "aws-cdk-lib/aws-s3";
import {BucketDeployment, Source} from "aws-cdk-lib/aws-s3-deployment";

export interface StaticSiteCnDomainProps {
    domainName: string;
    iamCertificateId: string,
    hostedZone?: string;
    isExternalDomain?: boolean;
    alternateNames?: string[];
}

export interface StaticSiteCnProps extends cdk.StackProps {
    customDomain: StaticSiteCnDomainProps;
    path: string;
    indexPage?: string;
    errorPage?: "redirect_to_index_page" | Omit<string, "redirect_to_index_page">;
    buildCommand?: string;
    buildOutput?: string;
    environment?: Record<string, string>;
    purgeFiles?: boolean;
}

export class StaticSiteCn extends cdk.Stack {
    public readonly domainName: string;
    public readonly iamCertificateId: string;
    public readonly cfnDistribution: cloudfront.CfnDistribution;

    constructor(scope: Construct, id: string, props?: StaticSiteCnProps) {
        super(scope, id, props);

        if (!props?.customDomain.domainName) {
            throw new Error("Must set domainName in china region.")
        }

        this.domainName = props.customDomain.domainName;
        this.iamCertificateId = props.customDomain.iamCertificateId;

        if (!fs.existsSync(props.path)) {
            throw new Error(
                `No path found at "${props.path}" for StaticSiteCn.`
            );
        }

        const sourceDir = props.buildCommand ? `${props.path}/${props.buildOutput}` : props.path;

        if (props.buildCommand) {

            if (!props.buildOutput) {
                throw new Error("Must set buildOutput if buildCommand exists.")
            }

            if (props.purgeFiles && fs.existsSync(sourceDir)) {
                fs.rmdirSync(sourceDir, {recursive: true});
            }

            try {
                console.log(`Building static site ${props.path}`);
                execSync(props.buildCommand, {
                    cwd: props.path,
                    stdio: "inherit",
                    env: {
                        ...env,
                        ...props.environment,
                    },
                });
            } catch (e) {
                throw new Error(
                    `There was a problem building the StaticSite: ` + e
                );
            }
        }

        props.indexPage = props.indexPage ? props.indexPage : "index.html";


        const bucket = new Bucket(this, 'Bucket', {
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            websiteIndexDocument: props.indexPage,
            blockPublicAccess: {
                blockPublicAcls: true,
                blockPublicPolicy: true,
                ignorePublicAcls: true,
                restrictPublicBuckets: true,
            }
        });

        new BucketDeployment(this, `BucketDeployment`, {
            destinationBucket: bucket,
            sources: [Source.asset(sourceDir)],
        });

        const oai = new OriginAccessIdentity(this, 'OriginAccessIdentity');
        const originAccessIdentity = `origin-access-identity/cloudfront/${oai.originAccessIdentityId}`;
        bucket.grantRead(oai);

        const bucketDomainName = this.region.startsWith('cn') ? `${bucket.bucketName}.s3.${this.region}.amazonaws.com.cn` : bucket.bucketDomainName;

        this.cfnDistribution = new cloudfront.CfnDistribution(this, `Distribution`, {

            distributionConfig: {
                aliases: [
                    this.domainName,
                ],
                origins: [
                    {
                        s3OriginConfig: {
                            originAccessIdentity,
                        },
                        connectionAttempts: 3,
                        connectionTimeout: 10,
                        domainName: bucketDomainName,
                        id: bucket.bucketName
                    }
                ],
                originGroups: {
                    quantity: 0
                },

                defaultCacheBehavior: {
                    viewerProtocolPolicy: "redirect-to-https",
                    allowedMethods: [
                        'HEAD',
                        'GET',
                    ],
                    cachedMethods: [
                        'HEAD',
                        'GET',
                    ],
                    compress: true,
                    defaultTtl: 360,
                    forwardedValues: {
                        queryString: true
                    },
                    maxTtl: 3600,
                    minTtl: 0,
                    smoothStreaming: false,
                    targetOriginId: bucket.bucketName,
                },
                comment: 'Live streaming',
                enabled: true,
                restrictions: {
                    geoRestriction: {
                        restrictionType: 'none'
                    }
                },
                httpVersion: 'http1.1',
                defaultRootObject: props.indexPage,
                ipv6Enabled: !this.region.startsWith('cn'),
                viewerCertificate: {
                    iamCertificateId: this.iamCertificateId,
                    minimumProtocolVersion: 'TLSv1',
                    sslSupportMethod: 'sni-only'
                }
            }
        });


        if (!props.customDomain.isExternalDomain) {

            if (!props.customDomain.hostedZone) {
                throw new Error("Must set hostedZone in china region if isExternalDomain is disabled.")
            }

            const hostedZone = route53.HostedZone.fromLookup(this, "Zone", {
                domainName: props.customDomain.hostedZone,
            });

            new route53.CnameRecord(this, "Cname", {
                zone: hostedZone,
                domainName: this.cfnDistribution.attrDomainName,
                recordName: this.domainName
            });

        }

    }
}
