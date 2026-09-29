# @prisma/orm-target-db2

Prisma 8 IBM Db2 LUW target: target descriptor, adapter, and driver packages.

This is the platform package for IBM Db2 LUW support in Prisma 8. It bundles:

- **`@internal/target-db2`** — native Db2 data types, scalar codecs, and target runtime/control descriptors
- **`@internal/adapter-db2`** — SQL dialect lowering (`OFFSET … ROWS FETCH NEXT … ROWS ONLY`), identifier quoting, and codec registry
- **`@internal/driver-db2`** — `ibm_db`-backed `SqlDriver` with connection lifecycle, parameterized execution, and isolated transactions

## Usage

Install alongside `@prisma/orm-family-sql` and the `ibm_db` native driver:

```sh
npm install @prisma/orm-target-db2 ibm_db
```

For the full ORM experience (contract authoring, queries, migrations) install the facade:

```sh
npm install @prisma/orm-db2 ibm_db
```
