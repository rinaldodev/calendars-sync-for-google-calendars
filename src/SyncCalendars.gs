/**
 * Script to Sync between 2 Google Calendars.
 * Check GitHub for documentation and how to set up.
 * 
 * https://github.com/rinaldodev/calendars-sync-for-google-calendars
 */

/**
 * BASIC CONFIG
 */

// The ID of the source calendar where events will be copied from.
const SOURCE_CALENDAR_ID = "source_email@gmail.com";

// The ID of the calendar where the events will be copied to.
const TARGET_CALENDAR_ID = "target_email@gmail.com";

// Number of days in the past and future to sync between calendars. 
// Avoid big numbers so you don't consume so much quota: https://developers.google.com/calendar/api/guides/quota and https://developers.google.com/apps-script/guides/services/quotas
// Sync is calculated from midnight. If both values are 0 it means only today is getting synchronized.
// 7 * X = shortcut for weeks
const SYNC_DAYS_IN_PAST = 7 * 1; // Default is 1 week in the past
const SYNC_DAYS_IN_FUTURE = 7 * 4; // Default is 4 weeks in the future

// A prefix to be added to the target calendar event. An emoji that represents the source calendar theme might be useful. Can be left as an empty string.
const EVENT_PREFIX = "💼";

// Default title for events that don't have a title in the source calendar.
const DEFAULT_EVENT_TITLE = "Busy";

// Visibility of the event created in the target calendar
// "public" - The event is public and event details are visible to all readers of the target calendar.
// "private" - The event is private and only event attendees may view event details (in this script this means only the owner of the calendar)
const TARGET_EVENT_VISIBILITY = "public";

// Color of the event created in the target calendar
// https://google-calendar-simple-api.readthedocs.io/en/latest/colors.html#event-colors 
const TARGET_EVENT_COLOR = 3;

/**
 * UTILITY/TEST CONFIG
 */

// Wether you want to reset all tokens and properties to force a full sync.
// This is specially useful if you were doing some testing and got the incremental sync in a bad state.
const FORCE_FULL_SYNC = false;

// Wether you want to run only the deletion of events.
// This is specially useful if you want just to clear the target calendar, or if you want to change the UNIQUE_SEARCH_CHARACTER constant, so you run this before changing it.
const DELETE_ONLY = false;

/**
 * SKIP/FILTER EVENTS CONFIG
 * 
 * For more info on customizing the skip settings, take a look at the Event resource documentation: https://developers.google.com/calendar/api/v3/reference/events
 */

// Which transparency event settings to skip. Default is "transparent", so it won't clone events that don't block time in the calendar.
const SKIP_TRANSPARENCY = ["transparent"];

// Which visibility event settings to skip. Default is "private" and "confidential", so it won't clone sensitive events.
const SKIP_VISIBILITY = ["private", "confidential"];

// Whether to skip events that were declined by the user of the source calendar. The source calendar email is used to perform the check.
const SKIP_DECLINED = true;

// Which event status to skip. Defaults to cancelled events.
const SKIP_STATUS = ["cancelled"]

// Which event types to *include*, all others are ignored. Defaults to "default" only.
// Other possible types are "birthday", "focusTime", "fromGmail", "outOfOffice", "workingLocation".
const INCLUDE_TYPES = ["default"]

// Strings used to filter out events by their title. This is specially useful to skip events that were copied from another calendar by using this same tool, like when you set-up a 2-way sync between 2 calendars.
const SKIP_SUMMARY_INCLUDES = ["\u200B", "🏠"]

// If you want to add any other property to be skipped, this is the place. Keys should be the event object property to filter and values should be an array of unwanted strings.
// E.g.:
// const AVANCED_SKIP = {
//     {  "organizer.email" , ["<your_email>" , "<unwanted_email>"]  },
//     {  "source.url"      , ["meet"         , "slack"]             },
//   };
const AVANCED_SKIP = {};

/**
 * SYSTEM/UNFRIENDLY CONFIG
 * 
 * If you are not sure what you are doing, don't change them.
 */

// Unique character to use in the title of the event to identify it as a clone. This is used to find and delete all previously created events.
// If you change this before deleting all the existing events, they will never get deleted by the script.
// https://unicode-table.com/en/200B/
const UNIQUE_SEARCH_CHARACTER = "\u200B";

// A unique key to be used to store the sync token.
// You only need to change this if you have multiple sync scripts running for the same source and target calendar.
const SYNC_TOKEN_KEY = "SYNC_KEY_" + SOURCE_CALENDAR_ID + "_" + TARGET_CALENDAR_ID;

// A unique key to be used to store the amount of errors occured
// while trying to use the current sync key. This is used to reset
// the sync key after X amount of errors and perform a full sync instead.
const ERROR_COUNT_KEY = SYNC_TOKEN_KEY + "-ERRORS";

// How many tries are allowed before we give up using the current sync token and switch to a full sync.
const SYNC_ERROR_THRESHOLD = 10;

// Base endpoint for the calendar API
const ENDPOINT_BASE = "https://www.googleapis.com/calendar/v3/calendars";

// Where to store properties. The Script Properties is good enough for most cases.
// https://developers.google.com/apps-script/guides/properties
const PROPERTIES = PropertiesService.getScriptProperties();

/**
 * INIT
 */

// Today at midnight - SYNC_DAYS_IN_PAST
const START_TIME = new Date();
START_TIME.setHours(0, 0, 0, 0);
START_TIME.setDate(START_TIME.getDate() - SYNC_DAYS_IN_PAST);

// Today at midnight + SYNC_DAYS_IN_FUTURE + 1
const END_TIME = new Date();
END_TIME.setHours(0, 0, 0, 0);
END_TIME.setDate(END_TIME.getDate() + SYNC_DAYS_IN_FUTURE + 1);

/**
 * FUNCTIONS
 */

/**
 * Runs the main sync mechanism. This should be called in your triggers. A lock is used to prevent parallel runs.
 * 
 * It runs incremental sync if a sync token is available and the error threshold using the current sync token has not been reached yet.
 * Otherwise a full sync will be executed.
 */
function run() {
  let lock = LockService.getScriptLock();
  try {
    lock.waitLock(90000);  

    let keepGoing = _applyUtilityBehaviors();
    if (!keepGoing) {
      console.log(`Stopping execution because of utility behavior.`);
      return;
    }

    _validateErrorThreshold();
    
    let syncToken = PROPERTIES.getProperty(SYNC_TOKEN_KEY);

    if (!syncToken) {
      console.log(`No sync token found with key ${SYNC_TOKEN_KEY}, performing full sync.`);
      _runFullSync();
    } else {
      console.log(`Sync token found with key ${SYNC_TOKEN_KEY}, performing incremental sync using token ${syncToken}`);
      _runIncrementalSync(syncToken);
    }

    console.log(`Sync completed. Next sync token is ${PROPERTIES.getProperty(SYNC_TOKEN_KEY)}`);
  } finally {
    lock.releaseLock();
  }  
}

/**
 * Overwrites behaviors based on utility constants.
 * 
 * @returns {boolean} wether to continue execution.
 */
function _applyUtilityBehaviors() {
  if (DELETE_ONLY) {
    console.log("Forcing delete-only behavior");
    _runFullSync(true);
    return false;
  }

  if (FORCE_FULL_SYNC) {
    console.log("Forcing full-sync behavior");
    PROPERTIES.deleteAllProperties();
    return true;
  }

  return true;
}

/**
 * Checks wether the error threashold has been reached and resets the sync token if necessary.
 *
 * Obs.: This is needed because, in my experience, the sync mechanism is not 100% reliable. Sometimes I would get events I didn't excepted for, maybe because of an API change or just a random error. 
 * In any case, this adds one more layer of resilience before the script (and you calendars) end up in a bad state.
 */
function _validateErrorThreshold() {
  let errorCount = PROPERTIES.getProperty(ERROR_COUNT_KEY);

  if (!errorCount) {
    console.log(`Initializing error count with zero.`);
    errorCount = 0;
    PROPERTIES.setProperty(ERROR_COUNT_KEY, errorCount);
  } else if (errorCount >= SYNC_ERROR_THRESHOLD) {
    console.log(`Error threshold (${SYNC_ERROR_THRESHOLD}) has been reached (${errorCount}). Deleting the current sync token to force a full sync.`);
    PROPERTIES.deleteProperty(SYNC_TOKEN_KEY);
    PROPERTIES.deleteProperty(ERROR_COUNT_KEY);
  }
}

/**
 * Runs an incremental sync by using the stored syncToken. Increments error count in case it fails to sync with the token.
 */
function _runIncrementalSync(syncToken) {
  let requestArgs = { 
    singleEvents: true, 
    syncToken: syncToken, 
    eventTypes: INCLUDE_TYPES,
    maxAttendees: 1 
  };
  console.log(`Starting incremental sync with args ${JSON.stringify(requestArgs)}`);
  
  try {
    _syncEventsWithArgs(requestArgs);
  } catch (error) {
    if (error.code === 410) {
      console.log(`Invalid sync token while listing events, performing full sync instead. Error: ${JSON.stringify(error)}`);
      return _runFullSync();
    } else {
      let errorCount = PROPERTIES.getProperty(ERROR_COUNT_KEY);
      if (errorCount < SYNC_ERROR_THRESHOLD) {
        errorCount++;
        console.log(`Error while listing events. Current error count is ${errorCount}. Threashold is ${SYNC_ERROR_THRESHOLD}. Aborting.`);
        PROPERTIES.setProperty(ERROR_COUNT_KEY, errorCount);
      }
      throw error;
    }
  }
}

/**
 * Runs a full sync. This means:
 * - deleting all the events that were previously created in the target calendar (within the filtered time frame)
 * - searching for all of the events available in the source calendar  (within the filtered time frame)
 * - creating a copy of all of the events in the target calendar
 * 
 * @param {boolean} skipSync wether to skip the sync part (only deletes).
 */
function _runFullSync(skipSync) {
  _deleteAllCopiedEvents();

  if (!skipSync) {
    _syncAllEvents();
  }
}

/**
 * Deletes all the events that were previously created in the target calendar (within the filtered time frame).
 */
function _deleteAllCopiedEvents() {
  let requestArgs = {
      timeMin: START_TIME.toISOString(),
      timeMax: END_TIME.toISOString(),
      singleEvents: true,
      eventTypes: INCLUDE_TYPES,
      maxAttendees: 1,
      q: UNIQUE_SEARCH_CHARACTER
    };
  
  let requestList = [];
  let targetEvents;

  do {
    targetEvents = Calendar.Events.list(TARGET_CALENDAR_ID, requestArgs);
    console.log(`Events listed to be deleted, found ${targetEvents.items.length} events.`);

    for (const targetEvent of targetEvents.items) {
      // safety check since the search API currently ignores the UNIQUE_SEARCH_CHARACTER filter and instead returns all events
      if (targetEvent.summary && targetEvent.summary.includes(UNIQUE_SEARCH_CHARACTER)) {
        _addToBatchRequestList("DELETE", requestList, targetEvent)
      }
    }

    requestArgs.pageToken = targetEvents.nextPageToken;
    console.log(`Next page token for deletion? ${requestArgs.pageToken}`)
  } while (requestArgs.pageToken);

  console.log(`There are ${requestList.length} items in the batch request list to be deleted.`)
  _runBatchRequest(requestList);

  console.log(`Events deleted.`);
  PROPERTIES.deleteAllProperties();
}

/**
 * Finds all the events in the source calendar that needs to be copied and copy them to the target calendar.
 */
function _syncAllEvents() {
  let requestArgs = {
    timeMin: START_TIME.toISOString(),
    timeMax: END_TIME.toISOString(),
    singleEvents: true,
    eventTypes: INCLUDE_TYPES,
    maxAttendees: 1,
  }
  console.log(`Starting full sync with args ${JSON.stringify(requestArgs)}`);
  _syncEventsWithArgs(requestArgs);
}

/**
 * Synchronize events based on the request configuration.
 * The expeceted behavior is that a full sync will call this without a sync token, while an incremental sync calls with a sync token.
 */
function _syncEventsWithArgs(requestArgs) {
  let requestList = [];
  let events;

  do {
    events = Calendar.Events.list(SOURCE_CALENDAR_ID, requestArgs);
    console.log(`Events listed, found ${events.items.length} events to sync.`);

    for (const event of events.items) {
      _createEventRequest(event, requestList); 
    }

    requestArgs.pageToken = events.nextPageToken;
    console.log(`Next page token? ${requestArgs.pageToken}`)
  } while (requestArgs.pageToken);

  console.log(`There are ${requestList.length} items in the batch request list.`)
  _runBatchRequest(requestList);

  console.log(`Batch requests executed. Persisting sync token for the next run: ${events.nextSyncToken}`);
  PROPERTIES.setProperty(SYNC_TOKEN_KEY, events.nextSyncToken);
}

/**
 * Creates the request body for an event found in the source calendar and that may be copied-to or deleted-from the target calendar.
 * 
 * Filters are applied to check if the event should be copied, deleted, updated, or ignored.
 * 
 * For example, the event might have been copied when it was in an accepted state, but then it got declined, so it should be deleted from the target calendar.
 * 
 * A more comprehensive explanation of all possible outcomes:
 * - event pass all filters and is not in the target calendar: a request to _create_ the event in the target calendar will be added to the list.
 * - event pass all filters and is already in the target calendar: a request to _update_ the event in the target calendar will be added to the list.
 * - event doesn't pass all filters and is not in the target calendar: the event is ignored.
 * - event doesn't pass all filters and is already in the target calendar: a request to _delete_ the event in the target calendar will be added to the list.
 * 
 * @param {Calendar_v3.Calendar.V3.Schema.Event} sourceEvent the event to process
 * @param {Array} requestList the list where to add the request to be executed, if there is one
 */
function _createEventRequest(sourceEvent, requestList) {
  let stringRepresentation;
  if (sourceEvent.start && sourceEvent.summary) {
    stringRepresentation = `${sourceEvent.start} - ${sourceEvent.summary}`;
  } else {
    stringRepresentation = JSON.stringify(sourceEvent);
  }

  console.log(`Processing event: ${stringRepresentation}`);
  let existingTargetEventId = PROPERTIES.getProperty(sourceEvent.id);

  let shouldCopy = _shouldEventByCopied(sourceEvent);

  let summary = sourceEvent.summary;
  if (!summary || summary === "") {
    summary = DEFAULT_EVENT_TITLE;
  }

  var targetEvent = {
    id: existingTargetEventId,
    summary: `${UNIQUE_SEARCH_CHARACTER}${EVENT_PREFIX} ${summary}`,
    location: sourceEvent.location,
    description: sourceEvent.description,
    start: sourceEvent.start,
    end: sourceEvent.end,
    guestsCanModify: false,
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    locked: true,
    reminders: {
      useDefault: false
    },
    colorId: TARGET_EVENT_COLOR,
    visibility: TARGET_EVENT_VISIBILITY,
    anyoneCanAddSelf: false,
    status: sourceEvent.status,
  }

  if (!shouldCopy) {
    console.log(`Event should not be copied: ${stringRepresentation}`);
    if (existingTargetEventId) {
      console.log(`Adding request to delete the existing event in the target calendar: ${stringRepresentation}`);
      // if we shouldn't copy and it is present in the map, it means it was inserted before
      // so we have to delete it from the target calendar and from the properties map 
      _addToBatchRequestList("DELETE", requestList, targetEvent)
      PROPERTIES.deleteProperty(sourceEvent.id);
    }
  } else if (existingTargetEventId) {
    // if we already had an eventId in the properties map, we consider the event
    // to already exist in the target calendar
    console.log(`Adding request to update the event in the target calendar: ${stringRepresentation}`);
    _addToBatchRequestList("PUT", requestList, targetEvent);
  } else {
    // if not, then we generated a new id and insert a new event in the calendar and in the properties map
    console.log(`Adding request to create the event in the target calendar: ${stringRepresentation}`);
    targetEvent.id = (Math.random()+'').replace('.','');
    _addToBatchRequestList("POST", requestList, targetEvent);
    PROPERTIES.setProperty(sourceEvent.id, targetEvent.id);
  }
}

/**
 * Checks wether the source event should be copied based on all the configured filters.
 * 
 * @param {Calendar_v3.Calendar.V3.Schema.Event} sourceEvent
 * @returns {boolean} true if it should be copied, false otherwise
 */
function _shouldEventByCopied(sourceEvent) {

  for (const status of SKIP_STATUS) {
    if (sourceEvent.status === status) {
      return false;
    }
  }

  for (const transparency of SKIP_TRANSPARENCY) {
    if (sourceEvent.transparency === transparency) {
      return false;
    }
  }

  for (const visibility of SKIP_VISIBILITY) {
    if (sourceEvent.visibility === visibility) {
      return false;
    }
  }  

  if (!_checkDateAllowed(sourceEvent)) {
    return false;
  }

  if (SKIP_DECLINED && sourceEvent.attendees) {
    for (const attendee of sourceEvent.attendees) {
      if (attendee.email === SOURCE_CALENDAR_ID && attendee.responseStatus === "declined") {
        return false;
      }
    }
  }

  for (const word of SKIP_SUMMARY_INCLUDES) {
    if (sourceEvent.summary && sourceEvent.summary.includes(word)) {
      return false;
    }
  }

  for (const property in AVANCED_SKIP) {
    if (sourceEvent.hasOwnProperty(property)) {
      for (const filter of AVANCED_SKIP[property]) {
        if (sourceEvent[property].includes(filter)) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Checks wether any of the source event dates or datetimes are within START_TIME and END_TIME.
 * 
 * This assures that day-based or hour-based events get correctly filtered when using sync tokens.
 * 
 * It also assures that even if only the start or the end of the event are within the wanted range it will get copied to the target calendar.
 * 
 * @param {Calendar_v3.Calendar.V3.Schema.Event} sourceEvent
 * @returns {boolean} true if the event can be copied
 */
function _checkDateAllowed(sourceEvent) {
  let allDates = [];
  allDates.push(sourceEvent.start?.date)
  allDates.push(sourceEvent.start?.dateTime)
  allDates.push(sourceEvent.end?.date)
  allDates.push(sourceEvent.end?.dateTime)

  for (const date of allDates) {
    if (date) {
      let dateObj = new Date(date);
      if (dateObj > START_TIME && dateObj < END_TIME) {
        dateAllowed = true;
        break;
      }
    }
  }

  return false;
}

/**
 * Adds a request to the list based on the method argument provided.
 */
function _addToBatchRequestList(method, requestList, targetEvent) {
  let endpoint;
  let body;

  switch (method) {
    case "POST":
      endpoint = `${ENDPOINT_BASE}/${TARGET_CALENDAR_ID}/events?conferenceDataVersion=0&maxAttendees=1&sendNotifications=false&sendUpdates=none`;
      body = targetEvent;
      break;
    case "PUT":
      endpoint = `${ENDPOINT_BASE}/${TARGET_CALENDAR_ID}/events/${targetEvent.id}?conferenceDataVersion=0&maxAttendees=1&sendNotifications=false&sendUpdates=none`;
      body = targetEvent;
      break;
    case "DELETE":
      endpoint = `${ENDPOINT_BASE}/${TARGET_CALENDAR_ID}/events/${targetEvent.id}?conferenceDataVersion=0&maxAttendees=1&sendNotifications=false&sendUpdates=none`;
      break;
    default:
      throw new Error(`HTTP method not supported: ${method}`);
  }

  requestList.push({
    method: method,
    endpoint: endpoint,
    requestBody: body,
  })
}

/**
 * Runs all the requests as a batch. This ensures less use of API quota. The downside is that you only get an error after running the batch, so it delays errors.
 * Still this is usually preffered to avoid multiple API calls.
 */
function _runBatchRequest(requestList) {
  console.log(`Running batch request with ${requestList.length} items`);
  if (requestList.length > 0) {
    const result = new BatchRequest({
      batchPath: "batch/calendar/v3",
      requests: requestList,
    })

    if (result.length !== requestList.length) {
      console.log("Error when running batch request, deleting sync token to force full sync: " + result);
      PROPERTIES.deleteProperty(SYNC_TOKEN_KEY);
    }

    console.log(`${result.length} event requests executed.`)
  } else {
    console.log("No batch request to execute.")
  }
}
