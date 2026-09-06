import countriesData from 'world-countries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MetricRow = {
  x: string;
  y: number;
};

type CountryInfo = {
  cca2: string;
  name: {
    common: string;
  };
  latlng: number[];
  flag?: string;
};

const countries =
  countriesData as CountryInfo[];


function getHeaders() {

  const origin =
    process.env.PUBLIC_SITE_ORIGIN ||
    'https://aaccxy.com';

  return {
    'Access-Control-Allow-Origin':
      origin,

    'Access-Control-Allow-Methods':
      'GET, OPTIONS',

    'Access-Control-Allow-Headers':
      'Content-Type',

    'Cache-Control':
      'public, s-maxage=600, stale-while-revalidate=86400',

    'Vary':
      'Origin',
  };

}


async function readJson(
  response: Response
) {

  const text =
    await response.text();

  if (!response.ok) {

    throw new Error(
      `HTTP ${response.status}: ${text.slice(0, 300)}`
    );

  }

  try {

    return JSON.parse(text);

  } catch {

    throw new Error(
      `Invalid JSON: ${text.slice(0, 300)}`
    );

  }

}


export async function OPTIONS() {

  return new Response(
    null,
    {
      status: 204,
      headers: getHeaders(),
    }
  );

}


export async function GET(
  request: Request
) {

  try {

    const allowedOrigin =
      process.env.PUBLIC_SITE_ORIGIN ||
      'https://aaccxy.com';


    const requestOrigin =
      request.headers.get('origin');


    if (
      requestOrigin &&
      requestOrigin !== allowedOrigin
    ) {

      return Response.json(
        {
          error: 'Forbidden origin',
        },
        {
          status: 403,
          headers: getHeaders(),
        }
      );

    }


    const baseUrl =
      (
        process.env.UMAMI_BASE_URL ||
        'https://stats.aaccxy.com'
      ).replace(/\/$/, '');


    const username =
      process.env.UMAMI_API_USERNAME;


    const password =
      process.env.UMAMI_API_PASSWORD;


    const websiteId =
      process.env.UMAMI_WEBSITE_ID;


    if (
      !username ||
      !password ||
      !websiteId
    ) {

      throw new Error(
        'Missing Umami environment variables'
      );

    }


    /* ==============================================
       登录 Umami
       ============================================== */

    const loginResponse =
      await fetch(
        `${baseUrl}/api/auth/login`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body: JSON.stringify({
            username,
            password,
          }),

          cache: 'no-store',
        }
      );


    const loginData =
      await readJson(
        loginResponse
      );


    if (!loginData.token) {

      throw new Error(
        'Umami token missing'
      );

    }


    const headers = {

      Accept:
        'application/json',

      Authorization:
        `Bearer ${loginData.token}`,

    };


    /* ==============================================
       统计起始时间
       ============================================== */

    const startText =
      process.env.UMAMI_STATS_START_AT ||
      '2026-09-06T00:00:00Z';


    const parsedStart =
      Date.parse(startText);


    const startAt =
      Number.isFinite(parsedStart)
        ? parsedStart
        : 0;


    const endAt =
      Date.now();


    /* ==============================================
       国家
       ============================================== */

    const metricsUrl =
      new URL(
        `${baseUrl}/api/websites/${websiteId}/metrics`
      );


    metricsUrl.searchParams.set(
      'startAt',
      String(startAt)
    );


    metricsUrl.searchParams.set(
      'endAt',
      String(endAt)
    );


    metricsUrl.searchParams.set(
      'type',
      'country'
    );


    metricsUrl.searchParams.set(
      'limit',
      '500'
    );


    /* ==============================================
       总统计
       ============================================== */

    const statsUrl =
      new URL(
        `${baseUrl}/api/websites/${websiteId}/stats`
      );


    statsUrl.searchParams.set(
      'startAt',
      String(startAt)
    );


    statsUrl.searchParams.set(
      'endAt',
      String(endAt)
    );


    /* ==============================================
       在线人数
       ============================================== */

    const activeUrl =
      `${baseUrl}/api/websites/${websiteId}/active`;


    const [
      metricsResponse,
      statsResponse,
      activeResponse,
    ] =
      await Promise.all([

        fetch(
          metricsUrl,
          {
            headers,
            cache: 'no-store',
          }
        ),

        fetch(
          statsUrl,
          {
            headers,
            cache: 'no-store',
          }
        ),

        fetch(
          activeUrl,
          {
            headers,
            cache: 'no-store',
          }
        ),

      ]);


    const metrics =
      await readJson(
        metricsResponse
      ) as MetricRow[];


    const stats =
      await readJson(
        statsResponse
      );


    const active =
      await readJson(
        activeResponse
      );


    /* ==============================================
       创建国家索引
       ============================================== */

    const countryMap =
      new Map<
        string,
        CountryInfo
      >();


    countries.forEach(
      country => {

        if (country.cca2) {

          countryMap.set(
            country.cca2.toUpperCase(),
            country
          );

        }

      }
    );


    const maxVisitors =
      Math.max(
        1,
        ...metrics.map(
          item =>
            Number(item.y) || 0
        )
      );


    /* ==============================================
       转换 Cobe marker
       ============================================== */

    const countryStats =
      metrics
        .map(
          item => {

            const code =
              String(item.x || '')
                .toUpperCase();


            const info =
              countryMap.get(
                code
              );


            if (
              !info ||
              !Array.isArray(
                info.latlng
              ) ||
              info.latlng.length < 2
            ) {

              return null;

            }


            const visitors =
              Number(item.y) ||
              0;


            const ratio =
              Math.sqrt(
                visitors /
                maxVisitors
              );


            return {

              code,

              name:
                info.name.common,

              flag:
                info.flag || '',

              visitors,

              lat:
                Number(
                  info.latlng[0]
                ),

              lng:
                Number(
                  info.latlng[1]
                ),

              size:
                Math.min(
                  0.12,
                  0.025 +
                  ratio * 0.075
                ),

            };

          }
        )
        .filter(Boolean)
        .sort(
          (a: any, b: any) =>
            b.visitors -
            a.visitors
        );


    return Response.json(
      {

        updatedAt:
          new Date()
            .toISOString(),

        summary: {

          visitors:
            Number(
              stats.visitors || 0
            ),

          pageviews:
            Number(
              stats.pageviews || 0
            ),

          active:
            Number(
              active.visitors || 0
            ),

          countries:
            countryStats.length,

        },

        countries:
          countryStats,

      },
      {
        status: 200,
        headers: getHeaders(),
      }
    );


  } catch (error) {

    console.error(
      '[visitor-globe]',
      error
    );


    return Response.json(
      {
        error:
          'Visitor globe temporarily unavailable',
      },
      {
        status: 500,
        headers: getHeaders(),
      }
    );

  }

}
