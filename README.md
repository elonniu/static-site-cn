# static-site-cn

This is NPM package for static site on AWS China.

## Services

- S3
- CloudFront
- Route53

## Install

```shell
npm i --save-dev static-site-cn
```

## Use

```typescript
import {StaticSiteCn} from "static-site-cn";

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
