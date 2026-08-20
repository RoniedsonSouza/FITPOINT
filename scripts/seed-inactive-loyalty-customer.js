require('dotenv').config();
const { pool, SCHEMA } = require('../config/database');

async function main() {
  const client = await pool.connect();
  try {
    const phone = '11999998888';
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);

    const existing = await client.query(
      `SELECT id FROM ${SCHEMA}.loyalty_customers WHERE phone = $1`,
      [phone]
    );

    let customerId;
    if (existing.rows.length) {
      customerId = existing.rows[0].id;
      await client.query(
        `UPDATE ${SCHEMA}.loyalty_customers
         SET name = $1,
             total_visits = 5,
             total_rewards = 0,
             active = true,
             last_visit_at = $2,
             last_positive_visit_at = $2,
             updated_at = NOW()
         WHERE id = $3`,
        ['Cliente Teste Ausente', fourDaysAgo, customerId]
      );
      console.log(`Cliente atualizado (id=${customerId})`);
    } else {
      const ins = await client.query(
        `INSERT INTO ${SCHEMA}.loyalty_customers
           (name, phone, total_visits, total_rewards, active, last_visit_at, last_positive_visit_at, created_at, updated_at)
         VALUES ($1, $2, 5, 0, true, $3, $3, NOW(), NOW())
         RETURNING id`,
        ['Cliente Teste Ausente', phone, fourDaysAgo]
      );
      customerId = ins.rows[0].id;
      console.log(`Cliente criado (id=${customerId})`);
    }

    await client.query(
      `INSERT INTO ${SCHEMA}.loyalty_visit_events (customer_id, delta, source, created_at)
       VALUES ($1, 1, 'admin', $2)`,
      [customerId, fourDaysAgo]
    );

    const row = await client.query(
      `SELECT id, name, phone, total_visits, last_positive_visit_at, last_visit_at
       FROM ${SCHEMA}.loyalty_customers WHERE id = $1`,
      [customerId]
    );
    console.log(JSON.stringify(row.rows[0], null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
