import React from 'react';

export default function TermsOfServiceEnglishContent() {
  return (
    <div className="space-y-6 text-sm leading-relaxed">
      <section>
        <h2 className="text-lg font-semibold mb-2">1. Scope</h2>
        <p>
          These Terms form a legal agreement between you and Endfield Gacha Analyzer (&quot;the Tool&quot;) regarding
          your use of the Tool. By registering for or using the Tool, you confirm that you have read, understood, and
          agreed to be bound by these Terms.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">2. Service Description</h2>
        <p>
          The Tool is an unofficial third-party pull history analyzer that currently provides the following services:
        </p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>Importing and storing in-game pull history records.</li>
          <li>
            Reviewing import results, checking anomalous records, and controlled editing or deletion of pull history.
          </li>
          <li>Statistical analysis and visual presentation of pull data.</li>
          <li>A gacha simulator.</li>
          <li>Cross-device data synchronization.</li>
          <li>Anonymous global ranking and aggregate statistics.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">3. Disclaimer</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            The Tool is not affiliated with Arknights: Endfield, Gryphline, HyperGryph, or any related official entity.
          </li>
          <li>All in-game content, including names and images, remains the property of the game operator.</li>
          <li>
            The Tool does not guarantee absolute accuracy of analysis results. All outputs are provided for reference
            only.
          </li>
          <li>The Tool is not liable for direct or indirect losses arising from your use of the service.</li>
          <li>
            Simulator output does not represent or guarantee the exact in-game probability outcome of any real pull.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">4. Acceptable Use</h2>
        <p>When using the Tool, you agree to follow these rules:</p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>Do not use the Tool for activities that violate applicable laws or regulations.</li>
          <li>Do not attempt to access another user&apos;s data without authorization.</li>
          <li>Do not attack, overload, or abuse the Tool&apos;s servers or related infrastructure.</li>
          <li>Do not use the Tool to distribute unlawful or prohibited content.</li>
          <li>Do not issue large-scale automated requests against the Tool&apos;s APIs without permission.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">5. Account Management</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            You are responsible for safeguarding your account credentials. Losses caused by password leakage are your
            own responsibility.
          </li>
          <li>Each email address may register only one account.</li>
          <li>We reserve the right to restrict or suspend accounts that violate these Terms.</li>
          <li>
            For accounts that remain unused for a prolonged period, we reserve the right to clean related data after
            advance notice.
          </li>
          <li>
            You should review records before confirming an import and are responsible for choices to keep, skip, edit,
            or delete data. The Tool uses validation, auditing, and concurrency controls to reduce accidental changes,
            but it cannot guarantee that third-party source data is absolutely accurate.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">6. Intellectual Property</h2>
        <p>
          The Tool&apos;s source code, interface design, icons, and related assets excluding in-game materials are owned
          by the Tool&apos;s developers. The source code is released under an open-source license. Please refer to the
          repository license files for the exact terms.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">7. Service Changes and Termination</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>We reserve the right to modify, suspend, or terminate part or all of the service at any time.</li>
          <li>
            Before a planned termination, we will provide notice through in-site announcements and, when possible, allow
            data export.
          </li>
          <li>
            We are not responsible for service interruptions caused by force majeure, such as natural disasters or
            regulatory changes.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">8. Revisions to These Terms</h2>
        <p>
          We may update these Terms from time to time. Updated versions will be published on this page. For material
          changes, we may also notify users through in-site announcements. Continued use of the Tool means you accept
          the revised Terms.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">9. Governing Law and Dispute Resolution</h2>
        <p>
          These Terms are governed by the laws of the People&apos;s Republic of China. Any dispute arising from these
          Terms should first be resolved through friendly consultation. If consultation fails, either party may bring
          the dispute before the competent people&apos;s court at the operator&apos;s domicile.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">10. Contact</h2>
        <p>If you have any questions about these Terms, you can contact us through:</p>
        <ul className="list-disc pl-6 mt-2 space-y-1">
          <li>In-site ticket system</li>
          <li>GitHub Issues</li>
        </ul>
      </section>
    </div>
  );
}
