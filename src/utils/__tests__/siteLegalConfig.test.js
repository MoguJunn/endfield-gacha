import { describe, expect, it } from 'vitest';

import { resolveSiteLegalConfig } from '../siteLegalConfig.js';

const genericConfig = {
  icp_number: '主站 ICP',
  police_number: '主站公安备案',
};

describe('siteLegalConfig', () => {
  it('uses the existing legal config for the primary site', () => {
    expect(resolveSiteLegalConfig(genericConfig, 'https://ef-gacha.mogujun.icu')).toMatchObject({
      icpNumber: '主站 ICP',
      policeNumber: '主站公安备案',
    });
  });

  it('does not reuse the primary site numbers on the backup domain', () => {
    expect(resolveSiteLegalConfig(genericConfig, 'https://ef.nepst.cn')).toMatchObject({
      icpNumber: '',
      policeNumber: '',
    });
  });

  it('supports a separate registration entry for the backup domain', () => {
    expect(resolveSiteLegalConfig({
      ...genericConfig,
      legal_registration_by_domain: JSON.stringify({
        'ef.nepst.cn': {
          icp_number: '备用网址 ICP',
          police_number: '备用网址公安备案',
        },
      }),
    }, 'https://ef.nepst.cn/')).toMatchObject({
      icpNumber: '备用网址 ICP',
      policeNumber: '备用网址公安备案',
    });
  });
});
