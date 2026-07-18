const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTaobaoPublishSettings
} = require('../src/runtime');

test('taobao publish settings normalize selector and attribute objects', () => {
  const settings = normalizeTaobaoPublishSettings({
    token: 'token',
    categories: [
      {
        id: 'sideboard',
        defaults: {
          selectors: {
            title: 'input[name=title]',
            'attribute.材质': 'input[name=material]'
          },
          attributes: {
            材质: '实木'
          }
        }
      },
      {
        id: 'corner-cabinet',
        defaults: {
          selectors: 'broken',
          attributes: ['broken']
        }
      }
    ]
  });

  const sideboard = settings.categories.find(item => item.id === 'sideboard');
  const corner = settings.categories.find(item => item.id === 'corner-cabinet');
  assert.equal(sideboard.defaults.selectors.title, 'input[name=title]');
  assert.equal(sideboard.defaults.selectors['attribute.材质'], 'input[name=material]');
  assert.equal(sideboard.defaults.attributes.材质, '实木');
  assert.deepEqual(corner.defaults.selectors, {});
  assert.deepEqual(corner.defaults.attributes, {});
});
