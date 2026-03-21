const AdmZip = require("adm-zip");
const { parse } = require("csv-parse/sync");

// The official, live UVA TransLoc GTFS feed!
const GTFS_URL = "https://api.transloc.com/gtfs/uva.zip";

async function getTransitData() {
  console.log("🤠 Wrangler is lassoing live UVA transit data...");
  try {
    // 1. Fetch the live GTFS static zip feed
    const response = await fetch(GTFS_URL);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    // 2. Load into memory (perfect for hackathons, no messy file I/O)
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const zip = new AdmZip(buffer);

    // 3. Extract the two files Wrangler needs for routing
    const routesCsv = zip.readAsText("routes.txt");
    const stopsCsv = zip.readAsText("stops.txt");

    // 4. Parse CSVs into JSON objects
    const routesData = parse(routesCsv, { columns: true, skip_empty_lines: true });
    const stopsData = parse(stopsCsv, { columns: true, skip_empty_lines: true });

    // 5. Build clean lookup tables for the AI
    const lookupDb = { routes: {}, stops: {} };

    routesData.forEach((route) => {
      lookupDb.routes[route.route_id] = {
        shortName: route.route_short_name,
        longName: route.route_long_name,
        color: route.route_color ? `#${route.route_color}` : "#FFFFFF",
      };
    });

    stopsData.forEach((stop) => {
      lookupDb.stops[stop.stop_id] = {
        name: stop.stop_name,
        lat: parseFloat(stop.stop_lat),
        lon: parseFloat(stop.stop_lon),
      };
    });

    console.log(
      `✅ Wrangled ${Object.keys(lookupDb.routes).length} routes and ${Object.keys(lookupDb.stops).length} stops.`
    );
    return lookupDb;
  } catch (error) {
    console.error("❌ Wrangler dropped the lasso:", error);
    return { routes: {}, stops: {} };
  }
}

if (require.main === module) {
  getTransitData().then((db) => {
    const routeKeys = Object.keys(db.routes);
    if (routeKeys.length > 0) {
      console.log("\n🚌 Sample Route Extracted:");
      console.log(db.routes[routeKeys[0]]);
    }
  });
}

module.exports = { getTransitData };
