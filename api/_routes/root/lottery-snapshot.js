import lotteryHandler from 'open-lottery/api/router.js';
import { describeRegulationSchedule, REGULATION_CAMPAIGN_ID } from '../../../shared/regulationLottery.js';

export default function lotterySnapshot(req, res) {
  const sendJson = res.json.bind(res);
  res.json = (payload) => {
    const { campaign, site } = payload?.data ?? {};
    if (campaign?.id === REGULATION_CAMPAIGN_ID && campaign.closesAt && campaign.drawsAt) {
      // Use the live schedule in the existing rules, including after a reschedule.
      const timingRule = site?.rules?.items?.find(item => item.title === '活动时间');
      if (timingRule) timingRule.description = describeRegulationSchedule(campaign);
    }
    return sendJson(payload);
  };
  return lotteryHandler(req, res);
}
