// The smallest Lambda custom runtime: polls the Runtime API and answers every invocation with
// the Bun it was built by. https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html
const api = `http://${process.env.AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation`

while (true) {
  const next = await fetch(`${api}/next`, { timeout: false })
  const id = next.headers.get('lambda-runtime-aws-request-id')
  await fetch(`${api}/${id}/response`, {
    method: 'POST',
    body: JSON.stringify({ statusCode: 200, body: `hello from bun ${Bun.revision}\n` }),
  })
}
