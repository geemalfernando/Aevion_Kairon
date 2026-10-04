# Deploy Kairon v1.1.0-rc.1

This prerelease implements notification publishing and delivery, plus production security controls. Deploy to a separate staging environment first. Sri Lankan users can use AWS Mumbai (`ap-south-1`); the application operates in Asia/Colombo time. No AWS resources have been created by this release.

## Deployment choices

| Option | Use |
| --- | --- |
| AWS ECS + Supabase (recommended) | Supplied release template: API/PWA, notification publisher and worker, HTTPS ALB, WAF, private networking, SQS/DLQ, monitoring, optional encrypted Multi-AZ Redis |
| Docker Compose | Local demonstration with fixed demo accounts; not a hosted production authentication system |
| Complete AWS blueprint | A subsequent migration: RDS identity integration, CloudFront, Route 53 automation, private S3 media and independent ML/allocation services are not provisioned here |

The product is React/Vite + Capacitor + Fastify, retaining Supabase Auth/PostgreSQL. The attached blueprint describes a target; it is not a command to replace working technologies. Supabase private proof storage remains in use. Redis provides distributed rate limiting; live state uses authenticated SSE rather than a new WebSocket service.

## 1. Prepare AWS and the database

### AWS-assigned HTTPS address (no domain registration)

Use the updated checkout containing this CloudFront option; the original `v1.1.0-rc.1` tag does not include it. Copy `infra/aws/parameters.cloudfront.example.json` to the ignored `infra/aws/parameters.json`. Fill the VPC/subnets, Supabase project URL and Secrets Manager ARN. Keep `UseCloudFront=true`; omit `AppOrigin` and `CertificateArn`. No domain registration, Route 53 hosted zone, DNS records or ACM certificate are needed for this mode. The AWS-assigned hostname has no registration fee; CloudFront, ECS, ALB, NAT, WAF, Redis and other AWS resources still incur usage charges. This is not a free hosting stack.

Finish browser sign-in on your Mac and use its named profile:

```sh
aws login --profile kairon-staging --region ap-south-1
export AWS_PROFILE=kairon-staging
export AWS_REGION=ap-south-1
aws sts get-caller-identity
node scripts/deploy-aws.mjs plan kairon-staging infra/aws/parameters.json
node scripts/deploy-aws.mjs bootstrap kairon-staging infra/aws/parameters.json
node scripts/deploy-aws.mjs release kairon-staging infra/aws/parameters.json YOUR_UNIQUE_IMAGE_TAG
```

Complete the database/secrets preparation below before bootstrap/release. Use a clean, reviewed checkout that includes these infrastructure changes and a new immutable image tag. Bootstrap outputs `ApplicationUrl`, such as `https://d123example.cloudfront.net`. The application, publisher and worker automatically receive that origin. Allow the distribution/VPC origin to finish deploying; bootstrap has zero application tasks, so health checks succeed only after release. Add `ApplicationUrl` to your Supabase authentication Site URL/redirect allowlist as needed for your auth flows. Native builds must also use this HTTPS API URL.

The distribution requires HTTPS from browsers and connects to an internal ALB in private subnets through a [CloudFront VPC origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html). Mumbai supports this feature. The VPC must have an attached internet gateway and spare IPv4 addresses in the private subnets; `infra/aws/network.json` supplies the network. The helper automatically resolves the region's CloudFront origin-facing managed prefix list and limits ALB ingress to it. Its weight is 55 security-group rules; ensure your group quota permits it. The private CloudFront-to-ALB and ALB-to-task hops use HTTP; browser-to-CloudFront uses TLS. Requirements for encryption on every internal hop need a separate TLS design.

Caching is disabled for every path, including authentication and API errors. Cookies, authorization headers and query parameters reach the app. Compression is disabled so SSE heartbeat responses are not compressed by CloudFront. API proxy trust includes CloudFront and ALB; the CloudFront viewer function overwrites a dedicated client-IP header for the ALB's WAF login rate rule. Verify role login, refresh/logout, photo upload, opt-in browser push and SSE delivery/reconnection through `ApplicationUrl` before accepting staging. The ALB has no public endpoint in this mode. Restrict VPC/CloudFront configuration permissions to deployment operators.

### Preparation shared by both address options

1. Install AWS CLI v2, Docker/buildx and Node 22 or later. Sign in using AWS SSO (`aws sso login --profile YOUR_PROFILE`), set `AWS_PROFILE` and `AWS_REGION=ap-south-1`, and verify `aws sts get-caller-identity`. Use temporary credentials; never paste keys into chat or commit them.
2. For a custom domain, request and DNS-validate its ACM certificate in Mumbai. Skip domain/certificate setup with `UseCloudFront=true`. Use a dedicated Supabase staging project; disable public signup and assign roles/depots/outlets/vehicles using administrator-controlled `app_metadata`, not user metadata.
3. Back up the database. Apply all three SQL migrations in filename order: `202610010001_kairon.sql`, `202610010002_photos_bucket.sql`, `202610020001_notifications_security.sql`. The third migration extends the commit RPC atomically and validates active Auth sessions. Apply it before the new API image. Set Supabase backup/PITR and retention policies and test a restore before using customer data.
4. Use a VPC with two public and two private subnets in different AZs, DNS enabled, and NAT egress from each private subnet. Alternatively deploy `infra/aws/network.json` as a separate CloudFormation stack (IAM capability unnecessary); copy its subnet/VPC outputs. This provisions two NAT gateways and incurs ongoing charges.
5. Create a Secrets Manager JSON secret using the default AWS-managed encryption key: `publishableKey`, `secretKey` and a random `mediaSigningKey` of at least 32 characters. Obtain the Supabase keys from your project. Generate the signing key locally with `openssl rand -hex 32`. Secret values stay server-side. Customer-managed KMS requires additional scoped `kms:Decrypt` permissions.
6. Copy the parameter example for your address option to the ignored `infra/aws/parameters.json`. Fill VPC/subnets, Supabase URL and secret ARN; the custom-domain example also needs a certificate ARN and domain. The file contains references, not secret values. `ProvisionRedis=true` provisions a private, encrypted two-node Redis. Alternatively set `ProvisionRedis=false` and `RedisSecretArn` to a secret containing `redisUrl` using TLS (`rediss://`). Production requires one of these options.

## 2. Bootstrap, push and deploy

Run from a clean checkout of the release tag:

```sh
git checkout v1.1.0-rc.1
export AWS_REGION=ap-south-1
node scripts/deploy-aws.mjs plan kairon-staging infra/aws/parameters.json
node scripts/deploy-aws.mjs bootstrap kairon-staging infra/aws/parameters.json
node scripts/deploy-aws.mjs release kairon-staging infra/aws/parameters.json v1.1.0-rc.1
```

`plan` is read-only and prints configuration. `bootstrap` creates the infrastructure with all task counts zero and refuses an existing stack. `release` builds the non-root production image for linux/amd64, pushes a new immutable ECR tag, then updates the stack to the task counts in the parameter file (API defaults to two). Every subsequent build needs a new unique image tag. The helper minifies the CloudFormation template to fit AWS CLI's template size limit; do not directly upload the formatted release JSON through an inline-template API.

For a custom domain, create a DNS alias to `LoadBalancerDns` using `LoadBalancerHostedZoneId` from stack outputs; domain, certificate and `AppOrigin` must agree. For CloudFront mode, open `ApplicationUrl` directly and skip DNS setup. Verify ECR image scan findings and healthy ECS targets. Deploying with channels disabled is supported; publisher/worker counts remain zero until configured.

The task execution role reads only specified secret ARNs. API has no notification send privileges; publisher has queue-send privileges; worker has queue-consume and explicitly enabled provider permissions. ECS tasks are private, non-root and use a read-only filesystem. Browser TLS terminates at the ALB in custom-domain mode and at CloudFront in AWS-assigned hostname mode; private origin/task connections use HTTP. Add application TLS if your requirements mandate encryption on that hop. The stack provisions fixed task counts, not autoscaling. WAF counts the body-size rule for photo uploads; the API enforces upload size and PNG/JPEG/WebP signatures.

## 3. Configure notification channels

Notifications are opt-in in **Profile → Notifications**. Recipients are resolved from current administrator-managed identity, depot and resource assignment. The atomic database outbox publishes only notification IDs to SQS. Durable per-user/channel/device delivery records, leases, retries, 24-hour expiry and dead-letter handling support recovery. Delivery is at least once: a crash after provider acceptance can still cause a duplicate.

Create a separate Secrets Manager JSON notification secret with `encryptionKey` (64 hex characters, generated with `openssl rand -hex 32`). Do not rotate this encryption key without a migration that re-encrypts existing phones/subscriptions. Add its ARN as `NotificationSecretArn`.

### Browser push

Generate VAPID keys locally (`npx web-push generate-vapid-keys`). Add `vapidPublicKey`, `vapidPrivateKey`, `vapidSubject` (e.g. `mailto:ops@example.com`) to the notification secret and set `WebPushEnabled=true`. Users enable push and grant browser permission over HTTPS. Messages use generic lock-screen text and open the login screen; device subscriptions are encrypted and endpoints validated.

### Android/iOS push (FCM)

Create a Firebase project and configure the native applications. Add the Firebase service-account JSON **as a JSON string** under `firebaseServiceAccount` in the notification secret; set `FcmEnabled=true`. Keep `web/android/app/google-services.json`, `web/ios/App/App/GoogleService-Info.plist`, APNs keys and signing credentials outside Git. Enable the iOS Push Notifications capability and APNs credentials in Firebase, with the correct bundle IDs/team. Android needs notification permission. Build with `VITE_API_URL=https://YOUR_DOMAIN`, run Capacitor sync and produce signed native releases. The tracked legacy APK is a demonstration build, not a signed artifact of this release. Native bearer tokens are in memory; users reauthenticate after restarting the app. Physical-device delivery remains an acceptance check.

### Email (SES)

Verify the sender domain/email in Mumbai, configure DKIM and your DNS mail authentication policy, and obtain regional [SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) before emailing unverified recipients. Set `EmailEnabled=true`, `SesFromEmail` and `SesIdentityName` (verified domain or email). The template creates the SES configuration set and bounce/complaint SNS→SQS feedback subscription, which the worker validates against its configured topic. Permanent bounces and complaints suppress further app email. Test the SES mailbox simulator and suppression behavior before real delivery.

### SMS (SNS)

Set a spending limit, complete sandbox exit and configure the required [Sri Lanka sender registration](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations.html). Confirm applicable carrier/region support and origination permissions in AWS; an arbitrary sender ID is insufficient. Set `SmsEnabled=true` and `SmsSenderId` to the approved sender. SNS direct-number publish requires `sns:Publish` on `*`; this permission is only attached when SMS is enabled.

An administrator independently verifies phone ownership, then stores the E.164 number through stdin using `npm --prefix server run notifications:verify-phone -- USER_UUID --verified`, with server Supabase/encryption settings configured locally. Do not put the phone in command history. Users must subsequently enable SMS themselves. Only high/critical events qualify; ordinary updates do not create SMS charges.

### Start workers

After completing a channel's configuration, set `PublisherCount=1` and `WorkerCount=1`, then deploy using a new image tag (or update CloudFormation parameters using the already pushed image). All API/publisher/worker tasks must share the same secret values and flags. Secrets are injected at startup: rotate through Secrets Manager and restart all affected services. Outbox processing does not backfill notifications created before the migration; expired rows are skipped.

## 4. Verify staging and enable monitoring

```sh
export KAIRON_ORIGIN=https://YOUR_STAGING_DOMAIN
curl --fail "$KAIRON_ORIGIN/api/health"
curl --silent --output /dev/null --write-out '%{http_code}\n' "$KAIRON_ORIGIN/api/state"
curl --silent --output /dev/null --write-out '%{http_code}\n' "$KAIRON_ORIGIN/api/stream?token=forged"
```

Health should succeed; both protected requests must return 401. Use dedicated staging accounts to test four-role login, assignment/depot isolation, planning, offline replay, signed proof expiry, account switching, logout/revocation and task restart. Existing `test:smoke` accepts staging `API_URL` and `SEED_*` credentials. The destructive walkthrough/security scripts are for isolated local demo stacks only.

For each enabled provider, opt in one controlled recipient and trigger an authorized event. Inspect outbox, delivery records and queue/DLQ metrics. Test opt-out, duplicate queue messages, disabled/reassigned users, expired push registrations, bounce/complaint suppression and provider errors. Never replay a DLQ blindly: correct the cause, check notification expiry and delivery status, and redrive selected entries.

Subscribe and verify an operator destination to the stack's alarm SNS topic; it has no automatic subscribers. Verify a received alarm. Monitor unhealthy targets, task CPU/memory, server errors, queue age and DLQ depth. Choose an audit/outbox/delivery/contact retention policy and restricted export access; this release does not automate retention deletion. Use AWS budgets before provisioning; zero tasks still leaves ALB/NAT/WAF/Redis charges.

## 5. Production promotion and rollback

Use a separate account/project or stack and hostname. Set `DeploymentEnv=production`, configure TLS Redis, production secrets and provider approvals. Repeat migration/restore and acceptance checks, pin the verified image digest in your change record and protect production deployment access. Keep prior secure images/task revisions and a tested rollback procedure. Database migration rollback is separate: do not drop delivery/audit tables or undo committed event receipts. Avoid rolling back to the insecure pre-release API; prefer a forward fix with channels disabled if delivery fails. For a web/domain cutover, coordinate offline clients and native API URLs, monitor errors and preserve existing event IDs/deduplication.

CI validates builds, HTTP security and transactional notification migration behavior. Publishing a GitHub prerelease does not create AWS resources. Live AWS/provider tests, native signing/physical-device checks, a verified alert destination and restore drill are required before promoting this candidate.
