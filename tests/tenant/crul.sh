// // docs/curl-examples.sh
// // Quick smoke tests with curl (adjust host:port)
// # List
// curl -i -H 'x-request-id: demo' -H 'Authorization: Bearer <token-with-tenant:read>' \
//   'http://localhost:3000/api/v1/tenants?limit=10&sort=createdAt&order=desc'
//
// # Create (idempotent)
// curl -i -X POST -H 'Content-Type: application/json' -H 'Idempotency-Key: abc123' \
//   -d '{"name":"Acme","slug":"acme"}' 'http://localhost:3000/api/v1/tenants'
//
// # Get (with conditional)
//     curl -i 'http://localhost:3000/api/v1/tenants/<id>' -H 'If-None-Match: "ten-..."'
//
// # Update (optimistic concurrency)
// curl -i -X PUT -H 'Content-Type: application/json' -H 'If-Match: "ten-..."' \
//   -d '{"name":"Acme+","slug":"acme"}' 'http://localhost:3000/api/v1/tenants/<id>'
//
// # Delete (soft)
// curl -i -X DELETE 'http://localhost:3000/api/v1/tenants/<id>'
