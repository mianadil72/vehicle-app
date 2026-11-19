import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { generateVehicles } from './db/bulkVehicles.ts';
import { PRESS_PHOTOS, imageExtension, photoSlug } from './db/pressPhotos.ts';

describe('press photos', () => {
  const generated = new Set(generateVehicles().map((r) => `${r.make}|${r.model}`));
  const seed = readFileSync(new URL('./db/seed.sql', import.meta.url), 'utf8');

  it('lists each model once, for a model that is actually in the inventory', () => {
    const keys = PRESS_PHOTOS.map(([make, model]) => `${make}|${model}`);
    assert.equal(new Set(keys).size, keys.length);
    const unknown = PRESS_PHOTOS.filter(([make, model]) => !generated.has(`${make}|${model}`) && !seed.includes(`'${model}'`));
    assert.deepEqual(unknown, []);
  });

  it('uses https sources and https or local images', () => {
    for (const [make, model, source, image] of PRESS_PHOTOS) {
      assert.match(source, /^https:\/\//, `${make} ${model}`);
      assert.match(image, /^(https:\/\/|\/vehicles\/models\/)/, `${make} ${model}`);
    }
  });

  it('gives every model a distinct, URL-safe file name', () => {
    const slugs = PRESS_PHOTOS.map(([make, model]) => photoSlug(make, model));
    assert.equal(new Set(slugs).size, slugs.length);
    for (const s of slugs) assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.equal(photoSlug('Lamborghini', 'Huracán EVO'), 'lamborghini-huracan-evo');
    assert.equal(photoSlug('Honda', 'CR-V EX'), 'honda-cr-v-ex');
  });

  it('accepts only JPEG, PNG and WebP downloads', () => {
    assert.equal(imageExtension('image/jpeg'), 'jpg');
    assert.equal(imageExtension('image/png; charset=binary'), 'png');
    assert.equal(imageExtension('IMAGE/WEBP'), 'webp');
    assert.equal(imageExtension('text/html; charset=utf-8'), null);
    assert.equal(imageExtension('image/svg+xml'), null);
  });
});
