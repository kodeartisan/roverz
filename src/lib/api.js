/**
 * API Functions
 */
 /* global fetch console */
import JWT from './api.jwt';

// Consts and Libs
import { ModuleConfig, APIConfig, ErrorMessages } from '../constants/';
import AppUtil from './util';

// We'll use JWT for API Authentication
// const Token = {};
const Token = new JWT();

// Config
const HOSTNAME = APIConfig.hostname;
const ENDPOINTS = APIConfig.endpoints;
let USER_AGENT = `${ModuleConfig.appName}`;

function setUserAgent(ua) {
  USER_AGENT = ua;
}

// Number each API request (used for debugging)
let requestCounter = 0;

/* Helper Functions ==================================================================== */

/**
  * Sends requests to the API
  */
function handleError(err) {
  let error = '';
  if (typeof err === 'string') error = err;
  else if (err && err.message) error = err.message;

  if (!error) error = ErrorMessages.default;
  return error;
}

/**
  * Convert param object into query string
  * eg.
  *   {foo: 'hi there', bar: { blah: 123, quux: [1, 2, 3] }}
  *   foo=hi there&bar[blah]=123&bar[quux][0]=1&bar[quux][1]=2&bar[quux][2]=3
  */
function serialize(obj, prefix) {
  const str = [];

  Object.keys(obj).forEach((p) => {
    const k = prefix ? `${prefix}[${p}]` : p;
    const v = obj[p];

    str.push((v !== null && typeof v === 'object') ?
      serialize(v, k) :
      `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  });

  return str.join('&');
}

/**
  * Sends requests to the API
  */
function fetcher(method, inputEndpoint, inputParams, body) {
  let endpoint = inputEndpoint;
  const params = inputParams;

  return new Promise(async (resolve, reject) => {
    requestCounter += 1;
    const requestNum = requestCounter;

    // After x seconds, let's call it a day!
    const timeoutAfter = 7;
    const apiTimedOut = setTimeout(() => (
      reject(ErrorMessages.timeout)
    ), timeoutAfter * 1000);

    if (!method || !endpoint) return reject('Missing params (AppAPI.fetcher).');

    // Build request
    const req = {
      method: method.toUpperCase(),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
    };

    // Add Token
    // Don't add on the login endpoint
    if (Token.getStoredToken && endpoint !== APIConfig.endpoints.get(APIConfig.tokenKey)) {
      const apiToken = await Token.getStoredToken();
      if (apiToken) {
        req.headers.Authorization = `Bearer ${apiToken}`;
      }
    }

    // Add Endpoint Params
    let urlParams = '';
    if (params) {
      // Object - eg. /user?title=this&cat=2
      if (typeof params === 'object') {
        // Replace matching params in API routes eg. /user/{param}/foo
        Object.keys(params).forEach((param) => {
          if (endpoint.includes(`{${param}}`)) {
            endpoint = endpoint.split(`{${param}}`).join(params[param]);
            delete params[param];
          }
        });

        // Check if there's still an 'id' prop, /{id}?
        if (params.id !== undefined) {
          if (typeof params.id === 'string' || typeof params.id === 'number') {
            urlParams = `/${params.id}`;
            delete params.id;
          }
        }

        // Add the rest of the params as a query string
        urlParams = `?${serialize(params)}`;

      // String or Number - eg. /user/23
      } else if (typeof params === 'string' || typeof params === 'number') {
        urlParams = `/${params}`;

      // Something else? Just log an error
      } else {
        AppUtil.debug('You provided params, but it wasn\'t an object!', HOSTNAME + endpoint + urlParams);
      }
    }

    // Add Body
    if (body) req.body = JSON.stringify(body);

    const thisUrl = HOSTNAME + endpoint + urlParams;

    AppUtil.debug('', `API Request #${requestNum} to ${thisUrl}`);

    // Make the request
    return fetch(thisUrl, req)
      .then(async (rawRes) => {
        // API got back to us, clear the timeout
        clearTimeout(apiTimedOut);

        let jsonRes = {};

        try {
          jsonRes = await rawRes.json();
        } catch (error) {
          const err = { message: ErrorMessages.invalidJson };
          throw err;
        }

        // Only continue if the header is successful
        if (rawRes && rawRes.status === 200) { return jsonRes; }
        throw jsonRes;
      })
      .then((res) => {
        AppUtil.debug(res, `API Response #${requestNum} from ${thisUrl}`);
        return resolve(res);
      })
      .catch((err) => {
        // API got back to us, clear the timeout
        clearTimeout(apiTimedOut);

        const apiCredentials = Token.getStoredCredentials ? Token.getStoredCredentials() : {};

        // If unauthorized, try logging them back in
        if (
          !AppUtil.objIsEmpty(apiCredentials) &&
          err &&
          err.data &&
          err.data.status.toString().charAt(0) === 4 &&
          err.code !== 'jwt_auth_failed' &&
          Token.getToken
        ) {
          return Token.getToken()
            .then(() => { fetcher(method, endpoint, params, body); })
            .catch(error => reject(error));
        }

        AppUtil.debug(err, HOSTNAME + endpoint + urlParams);
        return reject(err);
      });
  });
}

/* Create the API Export ==================================================================== */
/**
  * Build services from Endpoints
  * - So we can call AppAPI.user.get() for example
  */
const AppAPI = {
  handleError,
  getToken: Token.getToken,
  deleteToken: Token.deleteToken,
  setUserAgent,
};

ENDPOINTS.forEach((endpoint, key) => {
  AppAPI[key] = {
    get: (params, payload) => fetcher('GET', endpoint, params, payload),
    post: (params, payload) => fetcher('POST', endpoint, params, payload),
    patch: (params, payload) => fetcher('PATCH', endpoint, params, payload),
    put: (params, payload) => fetcher('PUT', endpoint, params, payload),
    delete: (params, payload) => fetcher('DELETE', endpoint, params, payload),
  };
});

/* Export ==================================================================== */
export default AppAPI;
