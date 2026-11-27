import fileApi from "../../workers/file-upload-worker.js";

export async function onRequest({ request, env }) {
  return fileApi.fetch(request, env);
}
