import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RETENTION_DAYS = 30;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');

  if (
    !process.env.CRON_SECRET ||
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return Response.json(
      {
        ok: false,
        error: 'Unauthorized',
      },
      {
        status: 401,
      },
    );
  }

  if (!process.env.DATABASE_URL) {
    return Response.json(
      {
        ok: false,
        error: 'DATABASE_URL missing',
      },
      {
        status: 500,
      },
    );
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /*
     * ---------------------------------------------------------
     * 1. event_data
     *
     * event_data 属于 website_event 的子数据，
     * 必须先删除。
     * ---------------------------------------------------------
     */
    const eventData = await client.query(`
      DELETE FROM event_data ed
      USING website_event we
      WHERE ed.website_event_id = we.event_id
        AND we.created_at <
            NOW() - INTERVAL '${RETENTION_DAYS} days'
    `);

    /*
     * ---------------------------------------------------------
     * 2. revenue
     * ---------------------------------------------------------
     */
    const revenue = await client.query(`
      DELETE FROM revenue
      WHERE created_at <
            NOW() - INTERVAL '${RETENTION_DAYS} days'
    `);

    /*
     * ---------------------------------------------------------
     * 3. Session Replay
     * ---------------------------------------------------------
     */
    const replay = await client.query(`
      DELETE FROM session_replay
      WHERE created_at <
            NOW() - INTERVAL '${RETENTION_DAYS} days'
    `);

    /*
     * ---------------------------------------------------------
     * 4. Heatmap
     * ---------------------------------------------------------
     */
    const heatmap = await client.query(`
      DELETE FROM heatmap_event
      WHERE created_at <
            NOW() - INTERVAL '${RETENTION_DAYS} days'
    `);

    /*
     * ---------------------------------------------------------
     * 5. 主访问事件
     * ---------------------------------------------------------
     */
    const events = await client.query(`
      DELETE FROM website_event
      WHERE created_at <
            NOW() - INTERVAL '${RETENTION_DAYS} days'
    `);

    /*
     * ---------------------------------------------------------
     * 6. 删除已经没有任何访问事件的旧 session_data
     *
     * 不直接按 created_at 粗暴删除，
     * 避免影响仍有最近访问记录的 Session。
     * ---------------------------------------------------------
     */
    const sessionData = await client.query(`
      DELETE FROM session_data sd
      USING session s
      WHERE sd.session_id = s.session_id
        AND s.created_at <
            NOW() - INTERVAL '${RETENTION_DAYS} days'

        AND NOT EXISTS (
          SELECT 1
          FROM website_event we
          WHERE we.session_id = s.session_id
        )

        AND NOT EXISTS (
          SELECT 1
          FROM revenue r
          WHERE r.session_id = s.session_id
        )
    `);

    /*
     * ---------------------------------------------------------
     * 7. 删除已经没有统计数据引用的旧 Session
     * ---------------------------------------------------------
     */
    const sessions = await client.query(`
      DELETE FROM session s
      WHERE s.created_at <
            NOW() - INTERVAL '${RETENTION_DAYS} days'

        AND NOT EXISTS (
          SELECT 1
          FROM website_event we
          WHERE we.session_id = s.session_id
        )

        AND NOT EXISTS (
          SELECT 1
          FROM revenue r
          WHERE r.session_id = s.session_id
        )

        AND NOT EXISTS (
          SELECT 1
          FROM session_data sd
          WHERE sd.session_id = s.session_id
        )
    `);

    await client.query('COMMIT');

    return Response.json({
      ok: true,

      retentionDays: RETENTION_DAYS,

      cutoff: new Date(
        Date.now() -
          RETENTION_DAYS *
            24 *
            60 *
            60 *
            1000,
      ).toISOString(),

      deleted: {
        eventData: eventData.rowCount ?? 0,
        revenue: revenue.rowCount ?? 0,
        sessionReplay: replay.rowCount ?? 0,
        heatmapEvents: heatmap.rowCount ?? 0,
        websiteEvents: events.rowCount ?? 0,
        sessionData: sessionData.rowCount ?? 0,
        sessions: sessions.rowCount ?? 0,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error(
      '[purge-analytics]',
      error,
    );

    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error',
      },
      {
        status: 500,
      },
    );
  } finally {
    client.release();
    await pool.end();
  }
}
