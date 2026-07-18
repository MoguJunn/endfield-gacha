import React from 'react';
import { ENGLISH_COMMUNITY_DISCORD_URL } from '../../constants/community';

export default function PrivacyPolicyEnglishContent() {
  return (
    <div className="space-y-6 text-sm leading-relaxed">
      <section>
        <h2 className="text-lg font-semibold mb-2">1. Introduction</h2>
        <p>
          Endfield Gacha Analyzer (&quot;the Tool&quot;) is an unofficial third-party pull history analysis service and
          is not affiliated with the game operator. We take privacy seriously. This Privacy Policy explains what
          information we collect, how we use it, how it is stored, and how we protect it.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">2. Information We Collect</h2>
        <p>To provide analysis features, we may collect the following categories of information:</p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>
            <strong>Account information</strong>: the email address and username you provide during registration.
          </li>
          <li>
            <strong>Game data</strong>: pull history records you actively import, including pull time, item or character
            name, rarity, and related banner fields.
          </li>
          <li>
            <strong>Import review and change records</strong>: short-lived staged records, issue flags, and review
            choices, plus minimal audit information created when you edit, delete, or acknowledge anomalous records.
          </li>
          <li>
            <strong>Device information</strong>: basic technical data such as browser type and operating system, used to
            improve the product experience.
          </li>
          <li>
            <strong>Usage data</strong>: anonymized statistics such as page visits and feature usage.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">3. How We Use Information</h2>
        <p>We use the collected information only for the following purposes:</p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>Provide pull data analysis and statistics.</li>
          <li>Enable cross-device data sync.</li>
          <li>
            Provide pre-commit import review, anomaly review, controlled editing and deletion, and maintain data
            consistency and security auditing.
          </li>
          <li>Generate anonymized aggregate statistics, such as global average pull rankings.</li>
          <li>Handle account recovery requests, manual verification, and temporary password issuance.</li>
          <li>Improve the Tool&apos;s functionality and performance.</li>
          <li>Send service-related notices, such as maintenance announcements.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">4. Storage and Security</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Your data is stored on a security-focused cloud platform, currently Supabase.</li>
          <li>We rely on Row Level Security (RLS) to ensure users can access only their own records.</li>
          <li>Passwords are stored in encrypted form. We do not have access to your plaintext password.</li>
          <li>Data in transit is protected with HTTPS.</li>
          <li>
            Import review tasks expire. The server stores only a hash of the review access credential and does not
            retain the original official-login token. Necessary history change audits are retained on a minimized basis
            for security and data integrity.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">5. Information Sharing</h2>
        <p>
          We do not sell, trade, or transfer your personal information to third parties, except in the following
          situations:
        </p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>Anonymized statistical outputs, such as global average pull metrics.</li>
          <li>Cases required by applicable law or by lawful requests from government authorities.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">6. Cookies and Local Storage</h2>
        <p>
          The Tool uses browser local storage (`localStorage`) to keep necessary UI state and read-only cache snapshots,
          and session storage (`sessionStorage`) to restore an unfinished official-import review during the current
          browser session. These values stay on your device to improve loading speed and cross-page continuity. Writing
          to browser storage does not, by itself, upload data to our servers.
        </p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>
            <strong>Interface preferences</strong>: theme mode, selected banner, selected game account, desktop or
            mobile preference, captcha mode, and share theme.
          </li>
          <li>
            <strong>Local simulator state</strong>: pity counters, resource settings, intel books, and animation toggles
            isolated per site user and game account.
          </li>
          <li>
            <strong>Read-only cache snapshots</strong>: site config, public bootstrap data, character cache, and parts
            of global statistics used for offline fallback and fewer repeated requests.
          </li>
          <li>
            <strong>Import review session</strong>: a short-lived task identifier, access credential, and source used to
            recover the current review after a refresh. It is cleared when the task is completed, rejected, expired, or
            the session ends.
          </li>
        </ul>
        <p className="mt-2">
          Imported pull history, cloud-synced banner data, and account profile data are not considered server-backed
          solely because they exist in local storage. For signed-in users, the authoritative dataset remains the
          protected records stored in Supabase.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">7. Bot Checks and Security Risk Controls</h2>
        <p>
          To reduce automated registration, password reset abuse, account recovery abuse, and email sending abuse, the
          Tool may use Cloudflare Turnstile or an equivalent bot check / proof-of-work mechanism on security-sensitive
          flows such as registration, password reset, and account recovery. Turnstile may process technical information
          related to a verification request, such as browser environment signals, device and network signals,
          verification results, access time, IP address, and necessary security cookies, to determine whether a request
          is from a genuine user and to prevent abuse.
        </p>
        <p className="mt-2">
          When Cloudflare Turnstile is enabled, the service is provided by Cloudflare and is governed by
          Cloudflare&apos;s applicable terms. You can review the{' '}
          <a
            href="https://www.cloudflare.com/cloudflare-customer-dpa/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-endfield-yellow hover:underline"
          >
            Cloudflare Data Processing Addendum
          </a>
          ,{' '}
          <a
            href="https://www.cloudflare.com/privacypolicy/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-endfield-yellow hover:underline"
          >
            Cloudflare Privacy Policy
          </a>
          , and{' '}
          <a
            href="https://www.cloudflare.com/website-terms/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-endfield-yellow hover:underline"
          >
            Cloudflare Website Terms
          </a>{' '}
          for Cloudflare&apos;s data handling rules. We do not store raw Turnstile tokens or Cloudflare secrets in our
          own database; we only keep desensitized risk summaries, verification status, and necessary security audit
          records.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">8. Your Rights</h2>
        <p>You have the following rights:</p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>
            <strong>Access</strong>: review the personal data stored for you inside the Tool.
          </li>
          <li>
            <strong>Correction</strong>: update your account information.
          </li>
          <li>
            <strong>Deletion</strong>: regular users can self-delete their own account from Settings. If you cannot log
            in, you may submit an account recovery or deletion request for manual review.
          </li>
          <li>
            <strong>Export</strong>: export your pull history. JSON and CSV exports are meant for backup and re-import
            and may include structured fields such as banner, timestamp, and game account data.
          </li>
          <li>
            <strong>Share control</strong>: built-in share cards and share text are desensitized by default and do not
            include account identifiers, UID, exact timestamps, or raw pull-by-pull details.
          </li>
        </ul>
        <p className="mt-2">
          To exercise these rights, please use the in-app Settings page, export tools, or ticket system first. Account
          recovery and temporary password requests in the English flow are currently handled through our Discord server
          for manual review by the super admin:{' '}
          <a
            href={ENGLISH_COMMUNITY_DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-endfield-yellow hover:underline break-all"
          >
            {ENGLISH_COMMUNITY_DISCORD_URL}
          </a>
          .
        </p>
        <p className="mt-2">
          After a self-service deletion completes, the current account, pull history, self-created banners, unfinished
          import tasks, anomaly markers, history change audits, tickets, and ticket replies are removed according to
          their database relationships. Future recalculated global statistics will no longer include those pull records.
          Files you already exported, content already shared outside the site, and minimum account-recovery handling
          records retained where necessary for security, abuse prevention, or legal obligations are outside the scope of
          in-site recovery.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">9. Protection of Minors</h2>
        <p>
          The Tool is not intended for children under 14 years old. If you are under 14, please use the Tool only under
          the supervision of a parent or legal guardian.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">10. Policy Updates</h2>
        <p>
          We may update this Privacy Policy from time to time. Updated versions will be published on this page. For
          material changes, we may also provide notice through in-site announcements. Continued use of the Tool means
          you accept the updated policy.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">11. Contact</h2>
        <p>If you have any questions or suggestions about this Privacy Policy, you can contact us through:</p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>In-site ticket system</li>
          <li>
            <a
              href={ENGLISH_COMMUNITY_DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-endfield-yellow hover:underline break-all"
            >
              Discord server
            </a>{' '}
            for account recovery, temporary passwords, and support
          </li>
          <li>GitHub Issues</li>
        </ul>
      </section>
    </div>
  );
}
