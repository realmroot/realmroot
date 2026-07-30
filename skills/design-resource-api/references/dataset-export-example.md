# Dataset Export API Example

Use this independent scenario to test resource modeling. It does not describe
the Realmroot API.

## Requirements

A reporting service stores datasets. Clients can change dataset metadata,
configure complete export policies, start asynchronous exports, inspect their
progress, cancel pending work, retrieve completed results, and retry failed
exports.

## Resource Model

```text
GET    /datasets
POST   /datasets
GET    /datasets/{datasetId}
PATCH  /datasets/{datasetId}
DELETE /datasets/{datasetId}

GET    /datasets/{datasetId}/export-policy
PUT    /datasets/{datasetId}/export-policy

GET    /datasets/{datasetId}/export-jobs
POST   /datasets/{datasetId}/export-jobs
GET    /datasets/{datasetId}/export-jobs/{jobId}
DELETE /datasets/{datasetId}/export-jobs/{jobId}

GET    /datasets/{datasetId}/export-jobs/{jobId}/result
```

## Create Work

Create an export job in its collection:

```http
POST /datasets/dataset-123/export-jobs
Content-Type: application/json
Idempotency-Key: 4c8fd2a8-7e33-4c93-8ce7-158e3fbd8435

{
  "format": "csv",
  "compression": "gzip"
}
```

The job resource exists immediately even though processing is asynchronous:

```http
HTTP/1.1 201 Created
Location: /datasets/dataset-123/export-jobs/job-456
ETag: "job-456-1"
Content-Type: application/json

{
  "id": "job-456",
  "datasetId": "dataset-123",
  "status": "pending",
  "format": "csv",
  "compression": "gzip",
  "createdAt": "2026-07-30T14:00:00Z"
}
```

Read the job's canonical URI to inspect progress. Once complete, its
representation links to the result singleton:

```json
{
  "id": "job-456",
  "datasetId": "dataset-123",
  "status": "completed",
  "createdAt": "2026-07-30T14:00:00Z",
  "completedAt": "2026-07-30T14:01:12Z",
  "links": {
    "self": "/datasets/dataset-123/export-jobs/job-456",
    "result": "/datasets/dataset-123/export-jobs/job-456/result"
  }
}
```

Before completion, the result resource does not exist and `GET` returns `404`.

## Cancel And Retry

Delete a cancellable job resource:

```http
DELETE /datasets/dataset-123/export-jobs/job-456
If-Match: "job-456-1"
```

Return `204 No Content`. If processing has already completed and the job cannot
be deleted, return `409 Conflict`. A stale `ETag` returns `412 Precondition
Failed`.

Retry by creating another job rather than mutating the failed job:

```http
POST /datasets/dataset-123/export-jobs
Content-Type: application/json
Idempotency-Key: 8e812b21-fd7d-42a0-aa85-4d043f345946

{
  "format": "csv",
  "compression": "gzip",
  "sourceJob": "/datasets/dataset-123/export-jobs/job-456"
}
```

Return `201 Created` and the new job's `Location`. The failed job remains
available for audit.

## Replace And Update

Replace a complete singleton policy with idempotent `PUT`:

```http
PUT /datasets/dataset-123/export-policy
Content-Type: application/json
If-Match: "policy-7"

{
  "allowedFormats": ["csv", "json"],
  "maximumRetentionDays": 30
}
```

Partially update dataset metadata with an explicit patch format:

```http
PATCH /datasets/dataset-123
Content-Type: application/merge-patch+json
If-Match: "dataset-12"

{
  "name": "Quarterly Revenue"
}
```

## OpenAPI And Restish

Every routine operation has an `operationId` and remains hidden from the
generated command surface:

```yaml
/datasets/{datasetId}/export-jobs:
  post:
    operationId: createDatasetExportJob
    summary: Create an export job
    x-cli-hidden: true
    security:
      - resourceOAuth: [datasets:export]
```

Clients use generic commands:

```bash
restish get reports/datasets
restish post reports/datasets/dataset-123/export-jobs \
  'format: csv, compression: gzip'
restish get reports/datasets/dataset-123/export-jobs/job-456
restish delete reports/datasets/dataset-123/export-jobs/job-456
restish get reports/datasets/dataset-123/export-jobs/job-456/result
restish edit reports/datasets/dataset-123/export-policy
```

This API needs no dedicated CRUD commands. Its exceptional-command whitelist
is empty.
