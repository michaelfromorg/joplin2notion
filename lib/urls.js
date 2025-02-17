/**
 * URL Cleanup and Normalization Script
 *
 * Features:
 * - Attempts HTTPS upgrade
 * - Removes www prefix
 * - Removes tracking parameters
 * - Removes fragments (#)
 * - Normalizes paths
 * - Sorts query parameters
 * - Removes redundant ports
 */

import fetch from "node-fetch";
import { URL } from "url";

// Common tracking and analytics parameters to remove
const PARAMS_TO_REMOVE = new Set([
  // UTM parameters
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  // Social media
  "fbclid",
  "ref",
  "ref_src",
  "source",
  // Generic tracking
  "_ga",
  "_gl",
  "_tracking",
  // Other common parameters
  "gclid",
  "gclsrc",
  "dclid",
  "affiliate_id",
  "affiliate",
  "mc_cid",
  "mc_eid", // Mailchimp
  "zanpid", // Zanox
  "msclkid", // Microsoft
  "_hsenc",
  "_hsmi", // HubSpot
  "igshid", // Instagram
  "mkt_tok", // Marketo
  // Session and user tracking
  "session_id",
  "user_id",
  "visitor_id",
  // Device and platform
  "platform",
  "device",
  "device_id",
  // Time-based parameters
  "timestamp",
  "ts",
  "time",
  // Cache busting
  "cache",
  "nocache",
  "bust",
  "cb",
]);

// Parameters that should be preserved even if they look like tracking
const PARAMS_TO_KEEP = new Set([
  "page",
  "q",
  "search",
  "id",
  "category",
  "type",
  "sort",
  "filter",
]);

/**
 * Checks if HTTPS is available for a given URL
 * @param {string} url - The URL to check
 * @returns {Promise<boolean>}
 */
async function canUseHttps(url) {
  try {
    const httpsUrl = url.replace(/^http:/, "https:");
    const response = await fetch(httpsUrl, {
      method: "HEAD",
      timeout: 5000,
      redirect: "follow",
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Determines if a parameter looks like a tracking parameter
 * @param {string} param - The parameter name to check
 * @returns {boolean}
 */
function looksLikeTracking(param) {
  if (PARAMS_TO_KEEP.has(param.toLowerCase())) {
    return false;
  }

  const trackingPatterns = [
    /^_.*/, // Parameters starting with underscore
    /.*id$/, // Parameters ending with 'id'
    /.*click.*/, // Parameters containing 'click'
    /track(ing)?/, // Parameters containing 'track' or 'tracking'
    /ref(er(r)?)?/, // Parameters related to referrers
    /campaign/, // Campaign-related parameters
    /^src$/, // Source parameters
    /affiliate/, // Affiliate-related parameters
    /^s_.*/, // Adobe Analytics parameters
  ];

  return trackingPatterns.some((pattern) => pattern.test(param.toLowerCase()));
}

/**
 * Cleans and normalizes a URL
 * @param {string} inputUrl - The URL to clean
 * @param {Object} options - Cleaning options
 * @returns {Promise<{original: string, cleaned: string, changes: string[]}>}
 */
async function cleanUrl(inputUrl, options = {}) {
  const {
    tryHttps = true,
    removeWww = true,
    removeTrailingSlash = true,
    removeFragment = true,
    removeTracking = true,
    sortParams = true,
    removeEmptyParams = true,
    removeDefaultPorts = true,
  } = options;

  const changes = [];
  let url;

  try {
    // Normalize the URL first
    url = new URL(inputUrl);
  } catch (error) {
    throw new Error(`Invalid URL: ${inputUrl}`);
  }

  // Store original URL for comparison
  const originalUrl = url.href;

  // Try HTTPS upgrade if requested and currently using HTTP
  if (tryHttps && url.protocol === "http:") {
    const httpsAvailable = await canUseHttps(url.href);
    if (httpsAvailable) {
      url.protocol = "https:";
      changes.push("Upgraded to HTTPS");
    }
  }

  // Remove www if requested
  if (removeWww && url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.replace(/^www\./, "");
    changes.push("Removed www prefix");
  }

  // Remove default ports
  if (removeDefaultPorts) {
    if (
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ) {
      url.port = "";
      changes.push("Removed default port");
    }
  }

  // Clean up search parameters
  if (url.search) {
    const searchParams = new URLSearchParams(url.search);
    const originalParamCount = searchParams.toString().length;

    // Create a new URLSearchParams object for cleaned parameters
    const cleanedParams = new URLSearchParams();

    // Process all parameters
    for (const [key, value] of searchParams.entries()) {
      const shouldRemove =
        removeTracking &&
        (PARAMS_TO_REMOVE.has(key.toLowerCase()) || looksLikeTracking(key));

      if (!shouldRemove) {
        if (!removeEmptyParams || value.length > 0) {
          cleanedParams.append(key, value);
        }
      }
    }

    // Sort parameters if requested
    if (sortParams) {
      const sortedParams = new URLSearchParams(
        [...cleanedParams.entries()].sort()
      );
      url.search = sortedParams.toString();
    } else {
      url.search = cleanedParams.toString();
    }

    if (url.search.length !== originalParamCount) {
      changes.push("Removed tracking parameters");
    }
  }

  // Remove fragment if requested
  if (removeFragment && url.hash) {
    url.hash = "";
    changes.push("Removed URL fragment");
  }

  // Normalize path and remove trailing slash if requested
  let path = url.pathname;
  if (path !== "/") {
    // Remove duplicate slashes
    path = path.replace(/\/+/g, "/");

    // Remove trailing slash if requested
    if (removeTrailingSlash && path.endsWith("/")) {
      path = path.slice(0, -1);
    }

    if (path !== url.pathname) {
      url.pathname = path;
      changes.push("Normalized path");
    }
  }

  return {
    original: originalUrl,
    cleaned: url.href,
    changes,
  };
}

// Example usage and testing
async function testUrlCleaning() {
  const testUrls = [
    "http://www.example.com/path/?utm_source=test&page=2#section",
    "https://example.com/path//",
    "http://example.com:80/path?fbclid=123&q=test&ref=social",
    "https://www.site.com/article/?_ga=1.2.3.4&utm_campaign=spring#top",
  ];

  console.log("=== URL Cleaning Results ===\n");

  for (const url of testUrls) {
    try {
      const result = await cleanUrl(url);
      console.log(`Original: ${result.original}`);
      console.log(`Cleaned:  ${result.cleaned}`);
      console.log("Changes made:");
      result.changes.forEach((change) => console.log(`- ${change}`));
      console.log();
    } catch (error) {
      console.error(`Error processing ${url}:`, error.message);
    }
  }
}

// Export for module usage
export { cleanUrl };

console.log(process.argv);

// Run tests if executed directly
if (process.argv[1].endsWith("urls.js")) {
  console.log("Running URL cleaning tests...\n");
  (async () => {
    try {
      await testUrlCleaning();
    } catch (error) {
      console.error("Test failed:", error);
      process.exit(1);
    }
  })();
}
