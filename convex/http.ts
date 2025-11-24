import { httpRouter } from 'convex/server';
import { handleReplicateWebhook } from './music';
import { importBilibiliUsers, importCharacterAssets, generateImageItem, presenceImport } from './aiTown/agentOperations';

const http = httpRouter();

http.route({
  path: '/replicate_webhook',
  method: 'POST',
  handler: handleReplicateWebhook,
});

// Bilibili import endpoint
http.route({ path: '/bilibili_import', method: 'POST', handler: importBilibiliUsers });
http.route({ path: '/assets_import', method: 'POST', handler: importCharacterAssets });
http.route({ path: '/image_generate', method: 'POST', handler: generateImageItem });
http.route({ path: '/presence_import', method: 'POST', handler: presenceImport });

export default http;
