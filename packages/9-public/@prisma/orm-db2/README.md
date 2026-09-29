# @prisma/orm-db2

**Prisma 8 for IBM Db2 LUW** — the single package a Db2 application installs.

## Installation

```sh
npm install @prisma/orm-db2
```

`ibm_db` must also be installed:

```sh
npm install ibm_db
```

## Usage

```ts
import db2 from '@prisma/orm-db2/runtime';
import { contract } from './contract.js'; // generated from your Prisma contract

await using db = db2({ contract });
await db.connect({ connectionString: process.env.DATABASE_URL });

const users = await db.orm.User.findMany({});
```

## Environment Variable

Set `DATABASE_URL` to your Db2 DSN connection string, e.g.:

```
DATABASE_URL=DATABASE=mydb;HOSTNAME=localhost;PORT=50000;PROTOCOL=TCPIP;UID=db2inst1;PWD=secret;
```

## License

Apache-2.0
