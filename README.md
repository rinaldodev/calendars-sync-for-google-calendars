# Calendars Sync for Google Calendar

This is a script template for Google Apps Script that allows you to synchronize Google Calendars.

Just choose a source calendar and a target calendar and let the magic happens. 

Selected events will be copied from the source calendar to the target calendar.

## Advantages over other solutions

- Lightweight synchonization by using incremental sync
- Better performance and quota management by using batch requests
- Easily customizable by changing constant values
- Well documented and logged - easy to make your own changes
- Hability to run from any Google account
- Respect notifications settings by not recreating events everytime
- Copy only relevant events by using the default opinionated filters
- Safety checks to make sure unrelated events don't get affected

## Setting it up

### Permissions

The script will run inside a Google Apps Script associated to a Google Account. It doesn't matter if the account running this script is associated to the source or target calendar, or neither of them, as long as you give the necessary permissions for it.

- If the script runs in the same account as the target calendar, give permission to it to read events from the source calendar.
- If the script runs in the same account as the source calendar, give permission to it to modify events in the target calendar.
- If the script runs in a third account, give permission both permissions to it: read from source and write to target.

#### Step by step for permissions

1. Open one of the Google Calendars (the one from the account that is *NOT* running the script)
3. Go to the Settings menu (gear icon on top right)
5. Go to "Settings for my calendars" on the left side
7. Find your Calendar in the list
9. Go to "Share with specific people or groups"
11. Add the necessary permission as explained above

### Script

1. Log into the account that will run the script and go to the [Google Apps Scripts] website.
3. Click on "New Project".
4. Replace everything in `Code.gs` with the contents of [SyncCalendars.gs].
5. Create a new script file called `BatchRequests.gs` with the contents of [BatchRequests.gs].
6. Update as least the `SOURCE_CALENDAR_ID` and `TARGET_CALENDAR_ID` with the desired emails.
7. I recommend taking a look at all the basic settings to avoid having to force full syncs afterwards.
8. Click the `Project Settings` Gear icon on the left panel.
9. Check the `Show "appsscript.json" manifest file in editor`.
10. Go back to code editor on the left, and update the contents of appsscript.json with [appsscript.json].
11. Change the `timeZone` to your timezone. You can find a complete list [here](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

### Running for the first time

1. In the Google Apps Script editor make sure the "selected function to run" is set to `run`.
2. If you are fine with the current settings, click `Run` to execute the sync for the first time.
2. This will load the `Authorization required` window since it's your first time running the script.
3. Click on `Review permissions` and give it permission to your account.
2. This will trigger the first synchronization which is always a full sync.
3. It might take a few seconds or minutes depending on how many events you have.
4. When it's done you can check the results by taking a look at the target calendar.

### Adding triggers  

1. Click on the `Triggers` clock icon on the left panel.
2. Click on `Add Trigger`. You have 2 choices:

- **Time-driven** will run every X minutes/hours/etc. I recommend using this settings to avoid using too much quota.
- **From calendar** will run when a given calendar updates. Use this if you want instant synchonization with the risk of running out of quota.

3. In both cases you should use:

- "Choose which function to run": `SyncCalendarsIntoOne`
- "Choose which deployment should run": `Head`

The rest is up to you. Enjoy your calendars in sync!

If you feel like it, take a look at the more advanced constant options in the script.

## About quota

- Google App Scripts has a daily quote of 5k events created per day. See [Quotas for Google Services] and [Manage Quotas].

## Credits

This was based on and includes multiple parts of https://github.com/karbassi/sync-multiple-google-calendars

[Google Apps Scripts]: https://script.google.com/intro
[SyncCalendars.gs]: src/SyncCalendars.gs
[BatchRequests.gs]: src/BatchRequests.gs
[appsscript.json]: src/appsscript.json
[Quotas for Google Services]: https://developers.google.com/apps-script/guides/services/quotas
[Manage Quotas]: https://developers.google.com/calendar/api/guides/quota
