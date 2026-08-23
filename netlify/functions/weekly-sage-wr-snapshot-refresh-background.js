// netlify/functions/weekly-sage-wr-snapshot-refresh-background.js
//
// WEEKLY SAGE — WR SNAPSHOT BACKGROUND REFRESH
//
// PURPOSE
// -------
// Build one expensive WR weekly snapshot outside the customer request path.
//
// The normal weekly-sage-wr-snapshot endpoint serves only persisted snapshots.
// This background function explicitly invokes the refresh build, which writes
// the completed snapshot to Netlify Blobs for all later leaderboard requests.
//
// Example:
// /.netlify/functions/weekly-sage-wr-snapshot-refresh-background?season=2025&week=8&seasonType=reg
//
// Netlify background functions return HTTP 202 immediately and may continue
// running for up to the platform background-function execution limit.

const {
  handler: snapshotHandler
} = require(
  "./weekly-sage-wr-snapshot.js"
);

exports.handler =
  async function (
    event
  ) {
    const query =
      event
        .queryStringParameters ||
      {};

    const season =
      String(
        query.season ||
        new Date()
          .getFullYear()
      );

    const week =
      Number(
        query.week
      );

    const seasonType =
      String(
        query.seasonType ||
        "reg"
      )
        .trim()
        .toLowerCase();

    if (
      !Number.isInteger(
        week
      ) ||
      week < 2 ||
      week > 18
    ) {
      throw new Error(
        "week must be an integer from 2 through 18."
      );
    }

    if (
      ![
        "reg",
        "pre",
        "post",
        "all"
      ].includes(
        seasonType
      )
    ) {
      throw new Error(
        "seasonType must be reg, pre, post, or all."
      );
    }

    const response =
      await snapshotHandler({
        ...event,

        httpMethod:
          "GET",

        queryStringParameters: {
          season,

          week:
            String(
              week
            ),

          seasonType,

          refresh:
            "1"
        }
      });

    const statusCode =
      response &&
      Number(
        response.statusCode
      );

    if (
      !Number.isFinite(
        statusCode
      ) ||
      statusCode < 200 ||
      statusCode >= 300
    ) {
      let detail =
        "WR snapshot refresh failed.";

      try {
        const body =
          response &&
          response.body
            ? JSON.parse(
                response.body
              )
            : null;

        if (
          body &&
          (
            body.detail ||
            body.error
          )
        ) {
          detail =
            body.detail ||
            body.error;
        }
      } catch (error) {
        // Keep the generic detail above.
      }

      throw new Error(
        detail
      );
    }

    console.log(
      `Weekly SAGE WR snapshot refresh completed for ${season} Week ${week} (${seasonType}).`
    );
  };
