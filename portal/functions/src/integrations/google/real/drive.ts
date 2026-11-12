// UNVERIFIED. Written from the Drive API v3 reference and never run (see http.ts).
//
// Every request sets the shared-drive flags, since an item in a shared drive answers 404
// without them, and asks for a narrow field mask.
import type { DriveAdapter, DriveChange, DriveFile } from "../types";
import { asArray, asNumber, asObject, asString, googleRequest, type Json } from "./http";

const API = "https://www.googleapis.com/drive/v3";
const FILE_FIELDS =
  "id,name,mimeType,driveId,parents,trashed,webViewLink,modifiedTime,version,owners(displayName),lastModifyingUser(displayName,me),capabilities(canEdit,canListChildren)";
const ALL_DRIVES = "supportsAllDrives=true&includeItemsFromAllDrives=true";

function fileOf(json: Json): DriveFile {
  const capabilities = asObject(json.capabilities);
  const modifier = asObject(json.lastModifyingUser);
  const driveId = asString(json.driveId);
  return {
    id: asString(json.id),
    name: asString(json.name),
    mimeType: asString(json.mimeType),
    ...(driveId === "" ? {} : { driveId }),
    parents: asArray(json.parents).map((parent) => asString(parent)),
    trashed: json.trashed === true,
    webViewLink: asString(json.webViewLink),
    modifiedTime: asString(json.modifiedTime),
    version: asString(json.version),
    owners: asArray(json.owners).map((owner) => ({ displayName: asString(asObject(owner).displayName) })),
    ...(json.lastModifyingUser === undefined
      ? {}
      : { lastModifyingUser: { displayName: asString(modifier.displayName), me: modifier.me === true } }),
    capabilities: { canEdit: capabilities.canEdit === true, canListChildren: capabilities.canListChildren === true },
  };
}

export function realDrive(): DriveAdapter {
  return {
    about: async () => {
      const json = await googleRequest("drive", "GET", `${API}/about?fields=user(emailAddress)`);
      return { emailAddress: asString(asObject(json.user).emailAddress) };
    },
    getFile: async (fileId) =>
      fileOf(
        await googleRequest(
          "drive",
          "GET",
          `${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`,
        ),
      ),
    listPermissions: async (fileId) => {
      // Inherited permissions of a shared drive are included. Whether an account that was given
      // read access may list the permissions of an item is unverified.
      const json = await googleRequest(
        "drive",
        "GET",
        `${API}/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&pageSize=100&fields=${encodeURIComponent("permissions(type,role,emailAddress)")}`,
      );
      return asArray(json.permissions).flatMap((entry) => {
        const permission = asObject(entry);
        const type = asString(permission.type);
        if (type !== "user" && type !== "group" && type !== "domain" && type !== "anyone") return [];
        const emailAddress = asString(permission.emailAddress);
        return [{ type, role: asString(permission.role), ...(emailAddress === "" ? {} : { emailAddress }) }];
      });
    },
    listChildren: async (folderId, pageToken, pageSize = 100) => {
      const query = encodeURIComponent(`'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`);
      const json = await googleRequest(
        "drive",
        "GET",
        `${API}/files?${ALL_DRIVES}&q=${query}&orderBy=folder,name&pageSize=${pageSize}` +
          `${pageToken === undefined ? "" : `&pageToken=${encodeURIComponent(pageToken)}`}` +
          `&fields=${encodeURIComponent(`nextPageToken,files(${FILE_FIELDS})`)}`,
      );
      const next = asString(json.nextPageToken);
      const files = asArray(json.files).map((file) => fileOf(asObject(file)));
      return next === "" ? { files } : { files, nextPageToken: next };
    },
    copyFile: async (fileId, name, parentId) =>
      fileOf(
        await googleRequest(
          "drive",
          "POST",
          `${API}/files/${encodeURIComponent(fileId)}/copy?supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`,
          { name, parents: [parentId] },
        ),
      ),
    getStartPageToken: async () =>
      asString(
        (await googleRequest("drive", "GET", `${API}/changes/startPageToken?supportsAllDrives=true`)).startPageToken,
      ),
    listChanges: async (pageToken) => {
      const json = await googleRequest(
        "drive",
        "GET",
        `${API}/changes?${ALL_DRIVES}&pageToken=${encodeURIComponent(pageToken)}` +
          `&fields=${encodeURIComponent(`nextPageToken,newStartPageToken,changes(fileId,removed,time,file(${FILE_FIELDS}))`)}`,
      );
      const changes = asArray(json.changes).map((entry): DriveChange => {
        const change = asObject(entry);
        return {
          fileId: asString(change.fileId),
          removed: change.removed === true,
          time: asString(change.time),
          ...(change.file === undefined ? {} : { file: fileOf(asObject(change.file)) }),
        };
      });
      const next = asString(json.nextPageToken);
      return next === ""
        ? { changes, newStartPageToken: asString(json.newStartPageToken) }
        : { changes, nextPageToken: next };
    },
    watchChanges: async (pageToken, channel) => {
      const json = await googleRequest(
        "drive",
        "POST",
        `${API}/changes/watch?${ALL_DRIVES}&pageToken=${encodeURIComponent(pageToken)}`,
        {
          id: channel.id,
          type: "web_hook",
          address: channel.address,
          token: channel.token,
          expiration: String(channel.expiration),
        },
      );
      return { resourceId: asString(json.resourceId), expiration: asNumber(Number(json.expiration)) };
    },
    stopChannel: async (channelId, resourceId) => {
      await googleRequest("drive", "POST", `${API}/channels/stop`, { id: channelId, resourceId });
    },
  };
}
