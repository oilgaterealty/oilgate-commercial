/**
 * Oilgate Commercial → Google Drive relay. Runs inside YOUR Google account as a
 * free Apps Script project, so files land in your own Drive folders and no
 * outside user ever gets Drive access.
 *
 * Every minute it copies new uploads from the private Supabase bucket into
 * the property's Drive folder (the one set on the owner page), then marks
 * the upload as copied. Super Lab already reads that Drive folder.
 *
 * Setup (Project Settings → Script properties):
 *   SUPABASE_URL          https://YOUR-PROJECT.supabase.co
 *   SUPABASE_SERVICE_KEY  the project's secret/service key (never commit it)
 * Then run installTrigger() once and approve the Drive permission prompt.
 */
const BUCKET = 'commercial-files';

function props_() {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty('SUPABASE_URL');
  const key = p.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Script properties.');
  return { url: url.replace(/\/$/, ''), key };
}

function api_(path, opts) {
  const { url, key } = props_();
  const res = UrlFetchApp.fetch(url + path, Object.assign({
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    muteHttpExceptions: true,
  }, opts || {}));
  if (res.getResponseCode() >= 300) throw new Error(path + ' → ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  return res;
}

function relayUploads() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const pending = JSON.parse(api_('/rest/v1/commercial_uploads?select=id,deal_id,storage_path,file_name,mime,uploaded_by_role&drive_file_id=is.null&order=created_at&limit=20').getContentText());
    if (!pending.length) return;
    const folders = {};
    JSON.parse(api_('/rest/v1/commercial_deal_private?select=deal_id,drive_folder_id').getContentText())
      .forEach(function (r) { folders[r.deal_id] = r.drive_folder_id; });

    pending.forEach(function (u) {
      const folderId = folders[u.deal_id];
      if (!folderId) return; // no Drive folder set for this property yet
      const blob = api_('/storage/v1/object/' + BUCKET + '/' + u.storage_path.split('/').map(encodeURIComponent).join('/'), { method: 'get' })
        .getBlob().setName(u.uploaded_by_role + ' - ' + u.file_name);
      if (u.mime) blob.setContentType(u.mime);
      const file = DriveApp.getFolderById(folderId).createFile(blob);
      api_('/rest/v1/commercial_uploads?id=eq.' + u.id, { method: 'patch', payload: JSON.stringify({ drive_file_id: file.getId() }) });
    });
  } finally {
    lock.releaseLock();
  }
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'relayUploads') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('relayUploads').timeBased().everyMinutes(1).create();
}
