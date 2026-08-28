# Better Data Engineering

Data providers can now feed a deterministic transformation pipeline before rows become isolated tests:

```text
provider → cache → typed coercion → join → derived columns → filter → sample → row limit
```

## Typed columns and validation

```yaml
provider: csv
file: customers.csv
columns:
  customerId:
    type: string
    required: true
  spend:
    type: number
    required: true
  active: boolean
  joinedAt: date
  tier:
    type: string
    enum: [gold, silver, bronze]
```

Types are `string`, `number`, `boolean`, `date`, and `json`. Errors include the row number and column name. Dates normalize to ISO 8601. Numbers must be finite.

## Derived columns

```yaml
derive:
  fullName: "${firstName} ${lastName}"
  caseLabel: "${customerId}:${tier}"
```

Derivation is deterministic template substitution; it does not execute code.

## Filtering

```yaml
where:
  active: true
  spend:
    greaterThan: 100
  tier:
    in: [gold, silver]
```

Available predicates: `equals`, `notEquals`, `in`, `matches`, `greaterThan`, and `lessThan`. Multiple columns and predicates are ANDed.

## Deterministic sampling

```yaml
sample:
  count: 25
  seed: 2025
```

Other modes:

```yaml
sample: { first: 10 }
sample: { last: 10 }
sample: { every: 5 }
```

Seeded sampling preserves original source order after selection so test order is stable.

## Joins

```yaml
provider: csv
file: orders.csv
join:
  provider: json
  file: customers.json
  on: customerId
  kind: left
  prefix: customer_
```

`inner` and `left` joins are supported. The join key must be named by `on`. Prefixing avoids column collisions. Base-row values win on collision.

## Explicit provider caching

```yaml
provider: rest
url: https://qa.example.com/cases
cache: true
```

Caching is opt-in, process-local, and keyed by provider configuration. Cached rows are defensively cloned. It does not persist credentials or data to disk.

Existing safety gates remain: remote sources need `--allow-remote-data`, SQL/custom providers need `--allow-custom-code`, and `--max-rows` caps the transformed dataset.
