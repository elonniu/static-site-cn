# static-site-cn

This is NPM package for static site on AWS China.

## Services
- S3
- CloudFront

## Install

```shell
npm i --save-dev static-site-cn
```

## Use

```typescript
new StaticSiteCn(stack, "Web", {
    path: "web",
    customDomain: {
        domainName: "{domainName}",
        iamCertificateId: "{iamCertificateId}",
        hostedZone: "{hostedZone}",
    },
    buildCommand: "npm i && npm run build",
    buildOutput: "build",
});
```
