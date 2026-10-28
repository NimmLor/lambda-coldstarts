/**
 * Lets the bench and deploy workflows (.github/workflows/bench.yml, deploy.yml) deploy to the AWS
 * account the current credentials belong to. Creates or updates, idempotently:
 *
 * - the GitHub OIDC identity provider of the account,
 * - the role GitHub Actions assumes, trusted only from this repository's GitHub environments,
 *   with an inline policy for what `sst deploy` and the benchmark touch,
 * - those GitHub environments, deployable from main only, with the role's ARN as their
 *   AWS_ROLE_ARN secret.
 *
 * Needs admin credentials for the account (AWS_PROFILE from .env works) and a logged-in `gh`.
 *
 *   bun scripts/bootstrap-aws.ts [--environment bench,production] [--repo owner/name]
 */
import { parseArgs } from 'node:util'
import { $ } from 'bun'

const { values: args } = parseArgs({
  options: {
    environment: { type: 'string', default: 'bench,production' },
    repo: { type: 'string' },
  },
})

const ROLE_NAME = 'lambda-coldstarts-github'
const POLICY_NAME = 'deploy'
const OIDC_HOST = 'token.actions.githubusercontent.com'
// AWS no longer checks it for GitHub's provider, but the CLI still asks for one.
const OIDC_THUMBPRINT = '2b18947a6a9fc7764fd8b5fb18a863b0c6dac24f'
const AUDIENCE = 'sts.amazonaws.com'

const repo =
  args.repo ?? (await $`gh repo view --json nameWithOwner -q .nameWithOwner`.text()).trim()
const environments = args.environment!.split(',').map((name) => name.trim())
// With immutable subjects on, GitHub names the repo by owner and repo IDs too
// (repo:owner@123/name@456), so ask it for the prefix instead of building one.
const subClaim = (await $`gh api repos/${repo}/actions/oidc/customization/sub`.json()) as {
  use_default: boolean
  sub_claim_prefix?: string
}
if (!subClaim.use_default) {
  throw new Error(`${repo} customizes its OIDC subject claim; the trust policy expects the default`)
}
const subjectPrefix = subClaim.sub_claim_prefix ?? `repo:${repo}`
const subjects = environments.map((name) => `${subjectPrefix}:environment:${name}`)

const aws = async <T>(cmd: string[]): Promise<T> => {
  const out = (await $`aws ${cmd} --output json`.quiet()).stdout.toString().trim()
  return (out ? JSON.parse(out) : undefined) as T
}

const { Account: accountId } = await aws<{ Account: string }>(['sts', 'get-caller-identity'])
console.log(`Account ${accountId}, trusting ${subjects.join(', ')}`)

const providerArn = `arn:aws:iam::${accountId}:oidc-provider/${OIDC_HOST}`
const { OpenIDConnectProviderList: providers = [] } = await aws<{
  OpenIDConnectProviderList?: { Arn: string }[]
}>(['iam', 'list-open-id-connect-providers'])
if (providers.some((p) => p.Arn === providerArn)) {
  const { ClientIDList: audiences = [] } = await aws<{ ClientIDList?: string[] }>([
    'iam',
    'get-open-id-connect-provider',
    '--open-id-connect-provider-arn',
    providerArn,
  ])
  if (!audiences.includes(AUDIENCE)) {
    await aws([
      'iam',
      'add-client-id-to-open-id-connect-provider',
      '--open-id-connect-provider-arn',
      providerArn,
      '--client-id',
      AUDIENCE,
    ])
    console.log(`Added audience ${AUDIENCE} to the GitHub OIDC provider`)
  } else {
    console.log('Found the GitHub OIDC provider')
  }
} else {
  await aws([
    'iam',
    'create-open-id-connect-provider',
    '--url',
    `https://${OIDC_HOST}`,
    '--client-id-list',
    AUDIENCE,
    '--thumbprint-list',
    OIDC_THUMBPRINT,
  ])
  console.log('Created the GitHub OIDC provider')
}

const trustPolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { Federated: providerArn },
      Action: 'sts:AssumeRoleWithWebIdentity',
      Condition: {
        StringEquals: { [`${OIDC_HOST}:aud`]: AUDIENCE, [`${OIDC_HOST}:sub`]: subjects },
      },
    },
  ],
})

// The services infra/ deploys to, plus the S3 buckets and SSM parameter SST keeps its state in.
// IAM only for roles, so the workflow can create the functions' roles but not users, and never
// this role itself, so it can't widen its own trust.
const roleArn = `arn:aws:iam::${accountId}:role/${ROLE_NAME}`
const deployPolicy = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: [
        'acm:*',
        'cloudfront:*',
        'cloudfront-keyvaluestore:*',
        'dynamodb:*',
        'lambda:*',
        'logs:*',
        'route53:*',
        's3:*',
        'scheduler:*',
        'ssm:*',
        'states:*',
      ],
      Resource: '*',
    },
    {
      Effect: 'Allow',
      Action: 'iam:*',
      Resource: `arn:aws:iam::${accountId}:role/*`,
    },
    { Effect: 'Allow', Action: 'iam:CreateServiceLinkedRole', Resource: '*' },
    { Effect: 'Deny', Action: 'iam:*', Resource: roleArn },
  ],
})

try {
  await aws(['iam', 'get-role', '--role-name', ROLE_NAME])
  await aws([
    'iam',
    'update-assume-role-policy',
    '--role-name',
    ROLE_NAME,
    '--policy-document',
    trustPolicy,
  ])
  console.log(`Updated the trust policy of ${ROLE_NAME}`)
} catch (error) {
  if (!String((error as { stderr?: unknown }).stderr).includes('NoSuchEntity')) throw error
  await aws([
    'iam',
    'create-role',
    '--role-name',
    ROLE_NAME,
    '--assume-role-policy-document',
    trustPolicy,
    '--description',
    `GitHub Actions in ${repo}, environments ${environments.join(', ')}. Managed by scripts/bootstrap-aws.ts`,
  ])
  console.log(`Created ${ROLE_NAME}`)
}
await aws([
  'iam',
  'put-role-policy',
  '--role-name',
  ROLE_NAME,
  '--policy-name',
  POLICY_NAME,
  '--policy-document',
  deployPolicy,
])
console.log(`Put the ${POLICY_NAME} policy on ${ROLE_NAME}`)

// Only main may deploy to the environments, so only main's runs get a token the role trusts.
const branchPolicy = [
  '-F',
  'deployment_branch_policy[protected_branches]=false',
  '-F',
  'deployment_branch_policy[custom_branch_policies]=true',
]
for (const environment of environments) {
  const env = `repos/${repo}/environments/${environment}`
  await $`gh api --silent -X PUT ${env} ${branchPolicy}`
  const branches =
    await $`gh api ${env}/deployment-branch-policies -q ${'.branch_policies[] | select(.type == "branch") | .name'}`.text()
  if (!branches.split('\n').includes('main')) {
    await $`gh api --silent -X POST ${env}/deployment-branch-policies -f name=main -f type=branch`
  }
  console.log(`Restricted the ${environment} environment of ${repo} to main`)
  await $`gh secret set AWS_ROLE_ARN --repo ${repo} --env ${environment} --body ${roleArn}`.quiet()
  console.log(`Set AWS_ROLE_ARN=${roleArn} on the ${environment} environment of ${repo}`)
}
