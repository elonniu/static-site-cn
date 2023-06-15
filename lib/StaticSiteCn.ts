import * as cdk from 'aws-cdk-lib';
import {RemovalPolicy} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {env} from "process";
import * as fs from "fs";
import * as route53 from "aws-cdk-lib/aws-route53";
import {CfnDistribution, OriginAccessIdentity} from 'aws-cdk-lib/aws-cloudfront';
import {execSync} from "child_process";
import {Bucket} from "aws-cdk-lib/aws-s3";
import {BucketDeployment, Source} from "aws-cdk-lib/aws-s3-deployment";
import {BucketProps} from "aws-cdk-lib/aws-s3/lib/bucket";
import {CfnDistributionProps} from "aws-cdk-lib/aws-cloudfront/lib/cloudfront.generated";
import {merge} from "lodash-es";

export interface StaticSiteCnProps extends cdk.StackProps {
    bucket?: BucketProps,
    cfnDistribution?: CfnDistributionProps,
    customDomain: {
        domainName: string;
        iamCertificateId: string,
        hostedZone?: string;
        isExternalDomain?: boolean;
        alternateNames?: string[];
    };
    path: string;
    indexPage?: string;
    errorPage?: "redirect_to_index_page" | Omit<string, "redirect_to_index_page">;
    buildCommand?: string;
    buildOutput?: string;
    environment?: Record<string, string>;
    purgeFiles?: boolean;
}

export class StaticSiteCn extends cdk.Stack {
    public readonly bucket: Bucket;
    public readonly bucketDeployment: BucketDeployment;
    public readonly oai: OriginAccessIdentity;
    public readonly cfnDistribution: CfnDistribution;
    public readonly props: StaticSiteCnProps;

    constructor(scope: Construct, id: string, props: StaticSiteCnProps) {
        super(scope, id, props);

        this.props = props;

        this.buildCode();

        this.bucket = new Bucket(this, 'Bucket', merge(this.bucketDefault, props.bucket));
        this.bucketDeployment = new BucketDeployment(this, `BucketDeployment`, {
            destinationBucket: this.bucket,
            sources: [Source.asset(this.sourceDir)],
        });
        this.oai = new OriginAccessIdentity(this, 'OriginAccessIdentity');
        this.bucket.grantRead(this.oai);
        this.cfnDistribution = new CfnDistribution(this, `Distribution`, merge(this.cfnDistributionDefault, props.cfnDistribution));

        this.cnameRecord();
    }

    private get originAccessIdentity() {
        return `origin-access-identity/cloudfront/${this.oai.originAccessIdentityId}`;
    }

    private get indexPage(): string {
        return this.props.indexPage ? this.props.indexPage : "index.html";
    }

    private buildCode() {

        if (!fs.existsSync(this.props.path)) {
            throw new Error(
                `No path found at "${this.props.path}" for StaticSiteCn.`
            );
        }

        if (this.props.buildCommand) {

            if (!this.props.buildOutput) {
                throw new Error("Must set buildOutput if buildCommand exists.")
            }

            if (this.props.purgeFiles && fs.existsSync(this.sourceDir)) {
                fs.rmdirSync(this.sourceDir, {recursive: true});
            }

            try {
                console.log(`Building static site ${this.props.path}`);
                execSync(this.props.buildCommand, {
                    cwd: this.props.path,
                    stdio: "inherit",
                    env: {
                        ...env,
                        ...this.props.environment,
                    },
                });
            } catch (e) {
                throw new Error(
                    `There was a problem building the StaticSite: ` + e
                );
            }
        }
    }

    private cnameRecord() {

        if (!this.props.customDomain.isExternalDomain) {

            if (!this.props.customDomain.hostedZone) {
                throw new Error("Must set hostedZone in china region if isExternalDomain is disabled.")
            }

            const hostedZone = route53.HostedZone.fromLookup(this, "Zone", {
                domainName: this.props.customDomain.hostedZone,
            });

            new route53.CnameRecord(this, "Cname", {
                zone: hostedZone,
                domainName: this.cfnDistribution.attrDomainName,
                recordName: this.domainName
            });

        }
    }

    public get domainName(): string {
        return this.props.customDomain.domainName;
    }

    private get sourceDir() {
        return this.props.buildCommand ? `${this.props.path}/${this.props.buildOutput}` : this.props.path;
    }

    private get bucketDomainName(): string {
        return this.region.startsWith('cn') ?
            `${this.bucket.bucketName}.s3.${this.region}.amazonaws.com.cn`
            : this.bucket.bucketDomainName;
    }

    private get bucketDefault(): BucketProps {
        return {
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            websiteIndexDocument: this.indexPage,
            blockPublicAccess: {
                blockPublicAcls: true,
                blockPublicPolicy: true,
                ignorePublicAcls: true,
                restrictPublicBuckets: true,
            }
        };
    }

    private get cfnDistributionDefault(): CfnDistributionProps {
        return {

            distributionConfig: {
                aliases: [
                    this.domainName,
                ],
                origins: [
                    {
                        s3OriginConfig: {
                            originAccessIdentity: this.originAccessIdentity,
                        },
                        connectionAttempts: 3,
                        connectionTimeout: 10,
                        domainName: this.bucketDomainName,
                        id: this.bucket.bucketName
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
                    targetOriginId: this.bucket.bucketName,
                },
                comment: 'Live streaming',
                enabled: true,
                restrictions: {
                    geoRestriction: {
                        restrictionType: 'none'
                    }
                },
                httpVersion: 'http1.1',
                defaultRootObject: this.indexPage,
                ipv6Enabled: !this.region.startsWith('cn'),
                viewerCertificate: {
                    iamCertificateId: this.props.customDomain.iamCertificateId,
                    minimumProtocolVersion: 'TLSv1',
                    sslSupportMethod: 'sni-only'
                }
            }
        };
    }
}
