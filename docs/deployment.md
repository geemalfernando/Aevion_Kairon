# Deploy Kairon on AWS RDS in Sydney

This deployment replaces Supabase at runtime with private RDS PostgreSQL for application data and identities, and private S3 for proof files. It moves the existing application toward the KIRON cloud blueprint while keeping the working React/Vite/Capacitor and Fastify clients/API. Separate FastAPI, Flutter, allocation/ML services and WebSocket/Redis fanout are later changes; the live update mechanism remains authenticated SSE with database polling.

The Sydney network `kairon-staging-network` is already deployed in account `849960194138`. Mumbai was denied by the account's region policy; use `ap-southeast-2`. CloudShell uses your existing console session: do not run `aws login` or use the unavailable local profile there. An AWS-assigned `cloudfront.net` HTTPS hostname avoids domain registration. AWS resources, including the existing two NAT gateways, still incur charges or consume eligible credits. This is not permanently free hosting.

## What the RDS stack supplies

| Blueprint component | Implemented deployment |
| --- | --- |
| Private PostgreSQL | Encrypted RDS, optional Multi-AZ (default on), seven-day backups by default (`RdsBackupRetentionDays`; free-plan accounts need 1), deletion protection, verified TLS |
| Authentication | Administrator-provisioned RDS identities; salted scrypt passwords (32 MiB, r=8, p=3); 15-minute HS256 access JWTs; opaque rotating 30-day refresh sessions; replay/logout/disable revocation |
| Authorization | Current DB role/depot/assignment on every request; existing resource isolation and command checks |
| Proof storage | Private encrypted/versioned S3; server-issued ten-minute proof URLs through the authorized API; no public bucket access |
| App/notification services | Private non-root ECS/Fargate API, outbox publisher and delivery worker; SQS/DLQ with durable database leases/results |
| Security and monitoring | Regional WAF, Redis rate limits, Secrets Manager, CloudWatch logs/alarms, HTTPS-only CloudFront with private VPC origin |
| Privileged maintenance | Separate one-off migration task and execution role; runtime cannot edit identities, create tables or read master credentials |

CloudFront-to-ALB and ALB-to-task connections use HTTP inside the private network; viewer HTTPS terminates at CloudFront. RDS uses verified TLS and S3 requests use HTTPS. An all-hops TLS requirement needs an additional origin/application TLS design. Tasks do not autoscale yet. The template creates alarm topics but no operator subscriptions; subscribe and verify an operator destination before production.

## 1. Prepare and upload the current files

Use the updated checkout, not the old Supabase release tag. Generate the source archive with `node scripts/package-cloudshell.mjs`. It excludes `.env`, private data exports, local parameters and initial-user credentials. It includes uncommitted source changes, so review those before deploying. The older `kairon-cloudshell.tar.gz` bundle does not implement RDS.

Prepared local files in `artifacts/cloudshell/`:

- `kairon-rds-cloudshell.tar.gz`: source and deployment tools.
- `kairon-rds-users-secret.json`: **sensitive** initial account credentials as a Secrets Manager JSON `users` string. Staging accounts use a shared administrator-chosen password; the RDS account minimum is 10 characters. Use unique, longer passwords for production. Inspect this file locally for initial sign-in; never commit or paste its contents into chat.
- `kairon-supabase-export.json`: **private** source data and identity profiles. No live access/refresh sessions or reusable password hashes are exported.

In AWS CloudShell, select Actions → Upload file and upload those files separately to your home directory. The credentials/data are intentionally not in the source archive. Then run:

```sh
unset AWS_PROFILE
export AWS_REGION=ap-southeast-2
export AWS_DEFAULT_REGION=ap-southeast-2
export AWS_PAGER=""
mkdir -p "$HOME/kairon-rds-cloudshell"
tar -xzf "$HOME/kairon-rds-cloudshell.tar.gz" -C "$HOME/kairon-rds-cloudshell"
cd "$HOME/kairon-rds-cloudshell"
node scripts/configure-rds.mjs kairon-staging-network "$HOME/kairon-rds-users-secret.json"
node scripts/deploy-rds.mjs plan kairon-rds-staging infra/aws/parameters.json
```

`configure-rds` reads the existing network outputs, creates `kairon/rds-staging/users`, writes secret references/network IDs into ignored `infra/aws/parameters.json`, then removes the uploaded plaintext credential file. It refuses a duplicate secret name rather than overwriting existing credentials. If the secret was already created, copy the parameter example, fill the network IDs and set `InitialUsersSecretArn` to its existing ARN. Neither parameter files nor stack outputs contain secret values. Retain your protected local credential file until the initial users have signed in and passwords are managed securely.

The template generates independent runtime database, access-token signing, media-signing and notification-encryption secrets, and RDS manages the master password. No Supabase API key or Supabase project is required for the RDS runtime. `InitialUsersSecretArn` is optional for infrastructure bootstrap, but usable login accounts must exist before acceptance. Email verification is an administrator-owned flag; set it only after confirming ownership. There is no public signup/password-reset endpoint.

Default `RdsMultiAZ=true`, `ProvisionRedis=true`, and two API tasks match the availability design but consume more credits. A staging-only cost reduction can set `RdsMultiAZ=false`, `DesiredCount=1`, `ProvisionRedis=false` (in-process rate limits are correct with one API task) and `RdsBackupRetentionDays=1`, which an AWS free-plan account requires; the two NAT gateways still incur charges. Check available credits and service permissions before provisioning. Never enable demo authentication as a cost workaround.

## 2. Bootstrap without application tasks

```sh
node scripts/deploy-rds.mjs bootstrap kairon-rds-staging infra/aws/parameters.json
```

Use a new RDS application stack name, **not** the existing network stack name. Bootstrap refuses an existing application stack and creates all API/publisher/worker task counts at zero. It provisions RDS, proof storage, generated secrets, ECS definitions and CloudFront before any app runs. The helper resolves the supported regional default PostgreSQL engine/family and CloudFront managed prefix list; later operations preserve the selected engine version. Inspect `ApplicationUrl`, `ProofBucketName`, `LogGroupName` and other stack outputs. Creating RDS and the CloudFront VPC origin can take several minutes.

No DNS records or customer ACM certificate are required with `UseCloudFront=true`. The internal ALB accepts CloudFront origin-facing traffic only. Caching, error caching and compression are disabled; authorization headers, cookies and query strings reach the app. A viewer function overwrites the WAF client-IP header, and the API trusts exactly two proxy hops.

## 3. Build, migrate and activate

Choose a new immutable image tag. CloudShell has Docker/buildx and Node 20, which can run the helpers; the production image uses Node 22.

```sh
node scripts/deploy-rds.mjs image kairon-rds-staging infra/aws/parameters.json rds-20261002-1
export KAIRON_IMPORT_FILE="$HOME/kairon-supabase-export.json"
export KAIRON_UPDATE_USERS=true
node scripts/deploy-rds.mjs migrate kairon-rds-staging infra/aws/parameters.json
node scripts/deploy-rds.mjs activate kairon-rds-staging infra/aws/parameters.json rds-20261002-1
unset KAIRON_IMPORT_FILE KAIRON_UPDATE_USERS
```

`image` pushes a linux/amd64 non-root production image and updates task definitions while keeping services stopped; it refuses an already-running deployment. `migrate` uploads the private data export to the encrypted proof bucket's `migration/` prefix and runs the dedicated migration task inside the VPC. The runtime app never receives the master DB secret. Schema application is repeatable; the data import is one atomic transaction and refuses a nonempty target. Migration failure leaves services stopped. The initial accounts are created or, with explicit `KAIRON_UPDATE_USERS=true`, re-provisioned with their new passwords and all old sessions revoked. `activate` requires a successful migration task receipt matching this stack, image tag and schema before it starts app services. Do not change the image tag between image/migrate/activate.

For an empty staging database, omit `KAIRON_IMPORT_FILE`. In that case the API initializes an empty operation; import the approved reference data separately using `server/scripts/import-data.ts` from a task with the correct runtime settings. Competition data stays outside the source archive/container. For imported data, operation versions, event receipts, proof IDs, user UUIDs, suppression records and audit records are preserved. Old delivery leases are cleared; unexpired notifications can be republished with completed delivery records retaining deduplication. Legacy base64 proof rows remain readable, while new uploads use S3. Reconcile and migrate those old blobs before deleting them.

The exporter detects operational version changes during export and refuses an inconsistent snapshot. Before a real cutover, pause source writes/notification workers and take a fresh export from repository root:

```sh
server/node_modules/.bin/tsx --tsconfig server/tsconfig.json server/scripts/export-supabase.ts artifacts/cloudshell/kairon-supabase-export.json
```

Re-upload that snapshot before the initial migration. If encrypted contacts/push subscriptions exist, restore the original notification encryption key into the generated `ContactEncryptionSecretArn` secret before import; the importer checks its fingerprint and fails closed on mismatches. Do not rotate this key without re-encrypting all stored records. Imported users not in the initial account list need administrator-provisioned new passwords. There is no automatic transfer of Supabase password hashes or sessions.

Delete uploaded/import-staging data after verifying the migration and retaining an approved encrypted backup. The migration task may retain its import object if it fails; do not expose it or blindly retry an import into a nonempty database. Repeated schema/user maintenance should omit `KAIRON_IMPORT_FILE`.

## 4. Acceptance and notifications

Set `KAIRON_ORIGIN` to `ApplicationUrl` from the stack, then verify:

```sh
export KAIRON_ORIGIN=https://YOUR_DISTRIBUTION.cloudfront.net
curl --fail "$KAIRON_ORIGIN/api/health"
curl --silent --output /dev/null --write-out '%{http_code}\n' "$KAIRON_ORIGIN/api/state"
curl --silent --output /dev/null --write-out '%{http_code}\n' "$KAIRON_ORIGIN/api/stream?token=forged"
```

Health must succeed and the protected endpoints must return 401. Sign into all four roles using the private initial credential file. Check depot/resource isolation, offline-event replay, refresh after fifteen minutes, refresh/logout across browser tabs, signed proof expiry, a task restart, and SSE updates/reconnection through CloudFront. Native clients must be rebuilt with `VITE_API_URL=ApplicationUrl` and signed for their platforms; the tracked demo APK is not this deployment's native release.

Keep notification flags and publisher/worker counts at zero until provider setup is complete. The generated contact-encryption key is shared by API/publisher/worker. User consent remains opt-in and all delivery recipients are checked against fresh RDS identity/assignment data.

| Channel | Setup |
| --- | --- |
| Browser push | Generate VAPID keys locally (`npx web-push generate-vapid-keys`), store `vapidPublicKey`, `vapidPrivateKey`, `vapidSubject` in a separate JSON provider secret, set `NotificationSecretArn` and `WebPushEnabled=true` |
| Native push | Store Firebase service-account JSON as a JSON string under `firebaseServiceAccount` in that provider secret; set `FcmEnabled=true`; configure native Firebase/APNs signing and permissions |
| SES email | Verify sender identity in Sydney, configure DKIM/DNS mail authentication and request regional production access; set `EmailEnabled`, `SesFromEmail`, `SesIdentityName`; test feedback suppression |
| SNS SMS | Obtain sandbox exit, spending limits and required sender/carrier registration; set `SmsEnabled` and approved `SmsSenderId`; independently verify ownership before provisioning encrypted E.164 contact numbers |

SES email can be tested with a verified email identity without owning a domain, subject to sandbox restrictions. SMS/provider approvals and native physical-device tests remain external prerequisites. Only high/critical events qualify for SMS. Set `PublisherCount=1`, `WorkerCount=1` after configuration and use a new image tag:

```sh
node scripts/deploy-rds.mjs release kairon-rds-staging infra/aws/parameters.json rds-20261002-2
```

For phone verification, `server/scripts/set-notification-phone.ts` now supports RDS as well as the legacy source. Run it through an authorized private maintenance environment with the required runtime/encryption settings; phone input uses stdin. Users still independently opt into SMS afterward. Provider delivery is at least once; a crash after provider acceptance can duplicate a delivery. Verify consent, opt-out, invalid registrations, bounce/complaint suppression, retry/DLQ handling and a received alarm with controlled recipients before real delivery.

## 5. Password/role maintenance, promotion and rollback

Modify the separate initial-users secret through an authorized administrator workflow, then run a one-off migration task with `RDS_UPDATE_USERS=true` to explicitly update profiles/passwords and revoke those users' sessions. The helper's initial `migrate` mode refuses active services; later maintenance should run the existing `MigrationTaskDefinition` directly with an ECS `containerOverrides` environment override and inspect its exit code/logs. Updating the secret does not change users until the task runs. The runtime account cannot perform these identity updates. Keep privileged migration execution access restricted and remove the seed secret from task configuration once another tested administrator maintenance method is established.

Use a separate production stack and hostname/project boundary. Set `DeploymentEnv=production`, require TLS Redis, provision verified providers/alarms, configure retention policies and test an RDS snapshot restore. RDS defaults to deletion protection and snapshot-on-removal; S3 and generated secrets are retained. Cleanup is an explicit process, and retained resources/network NAT gateways continue to incur charges. Do not delete the existing network while either application stack needs it.

## 6. Continuous deployment from GitHub Actions

After the first `activate`, `.github/workflows/deploy-aws.yml` releases `main` to staging whenever CI passes on a push. It reads the deployed stack's parameters (`scripts/stack-parameters.mjs`), builds and pushes the image tagged `git-<commit>-<attempt>`, runs `deploy-rds.mjs release` and checks `/api/health` and the 401 guard on `ApplicationUrl`. It refuses to deploy a commit that changes `database/` or the migration/import/user scripts since the deployed image; run `migrate` by hand, then re-run the workflow. The first run after a hand-tagged release must be started manually (Actions → Deploy AWS staging → Run workflow).

The account's organization policy blocks GitHub OIDC providers, so CI uses an IAM user's access key. Deploy `infra/aws/github-deploy.json` once (stack `kairon-github-deploy`, `RepositoryName` = the part of `RepositoryUri` after the slash). The user can push only that ECR repository and change only the application stack, through an execution role that only CloudFormation can assume. Create its access key and store it in the GitHub `staging` environment without displaying it:

```sh
user=$(aws cloudformation describe-stacks --stack-name kairon-github-deploy --query "Stacks[0].Outputs[?OutputKey=='DeployerUserName'].OutputValue" --output text)
aws iam create-access-key --user-name "$user" --output json > /tmp/k.json
gh secret set AWS_ACCESS_KEY_ID --env staging --body "$(node -p "require('/tmp/k.json').AccessKey.AccessKeyId")"
gh secret set AWS_SECRET_ACCESS_KEY --env staging --body "$(node -p "require('/tmp/k.json').AccessKey.SecretAccessKey")"
rm /tmp/k.json
```

Set the `staging` environment variables `AWS_REGION=ap-southeast-2`, `KAIRON_STACK=kairon-rds-staging` and `KAIRON_CFN_ROLE_ARN` (the `ExecutionRoleArn` output). Rotate the key periodically by creating a new one, updating the secrets and deleting the old key.

Keep Supabase available during cutover/acceptance; the prepared export does not delete or modify the source. Rollback after new RDS writes needs a data reconciliation plan: pointing back to the old database can lose new deliveries, receipts or changes. Prefer a forward application fix using the same database. Previous image/task revisions can roll back application code only when compatible with the current schema. Future schema changes need a reviewed migration before `release`; the helper gates the initial migration, not arbitrary future SQL changes.

Local validation covers authentication/replay/revocation, runtime DB permissions, atomic state/outbox/audit writes and delivery leases, and proof conflicts. Live RDS TLS, account policy permissions, CloudFront streaming, provider acceptance, native signing and restore drills still need staging verification. The old Supabase deployment guide is retained in `docs/deployment-supabase.md` for source export/legacy reference; it is not the RDS deployment path.

Password hashing follows an [OWASP scrypt baseline](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Runtime audit/event/proof records allow insert/read but no update/delete; maintenance and retention require a privileged administrator task. API and notification services currently share the restricted database runtime role, while their AWS provider IAM permissions remain separate.
