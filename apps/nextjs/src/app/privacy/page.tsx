import { ThemeToggle } from "@acme/ui/theme";

import Footer from "~/app/components/home/footer";
import Header from "~/app/components/home/header";
import { URLS } from "~/lib/urls";

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 px-6 pb-20 pt-32">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-8 text-4xl font-bold">Privacy Policy</h1>
          <div className="space-y-6 font-mono text-sm leading-relaxed">
            <p className="text-muted-foreground">
              Last Updated: September 24, 2026
            </p>

            <section>
              <h2 className="mb-3 text-xl font-semibold">1. Introduction</h2>
              <p>
                whisp is committed to protecting your privacy. This Privacy
                Policy explains how we collect, use, disclose, and safeguard
                your information when you use our ephemeral messaging service.
                We are a privacy-first platform, and we have designed our
                service to minimize data collection and maximize user privacy.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-xl font-semibold">
                2. Information We Collect
              </h2>

              <h3 className="mb-2 mt-4 text-lg font-semibold">
                2.1 Discord Authentication Data
              </h3>
              <p className="mb-3">
                When you sign in to whisp using Discord, we collect the
                following information from your Discord account:
              </p>
              <ul className="ml-6 list-outside list-disc space-y-2">
                <li>Discord username</li>
                <li>Discord user ID</li>
                <li>Email address (if provided by Discord)</li>
                <li>Profile picture (if provided by Discord)</li>
              </ul>

              <h3 className="mb-2 mt-4 text-lg font-semibold">
                2.2 Usage Data and Analytics
              </h3>
              <p className="mb-3">
                We collect information about how you use whisp, including:
              </p>
              <ul className="ml-6 list-outside list-disc space-y-2">
                <li>
                  Feature usage patterns (which features you use and how often)
                </li>
                <li>Session duration and frequency</li>
                <li>Friend connections and interactions</li>
                <li>Error logs and crash reports</li>
              </ul>

              <h3 className="mb-2 mt-4 text-lg font-semibold">
                2.3 Device Information
              </h3>
              <p className="mb-3">
                We automatically collect certain information about your device,
                including:
              </p>
              <ul className="ml-6 list-outside list-disc space-y-2">
                <li>Device type and model</li>
                <li>Operating system and version</li>
                <li>Unique device identifiers</li>
                <li>Mobile network information</li>
                <li>IP address</li>
              </ul>

              <h3 className="mb-2 mt-4 text-lg font-semibold">
                2.4 Content Data
              </h3>
              <p>
                When you send photos or videos through whisp, we temporarily
                store this content on our servers only for the purpose of
                delivering it to the intended recipient. This content is
                permanently and automatically deleted from our servers
                immediately after the recipient views it. We do not analyze,
                scan, or use this content for any other purpose.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-xl font-semibold">
                Safety reports and blocks
              </h2>
              <p>
                When you report an account, we store your account ID, the
                reported account ID, the reason, any explanation you provide,
                and the time and outcome of review. Reports are available to
                authorized whisp operators for abuse prevention and moderation.
                They are not shown to the reported account. Reporting does not
                copy or preserve any photos or videos from your messages.
              </p>
              <p className="mt-3">
                We store the accounts you block to enforce your contact
                preferences, records of conduct-policy acceptance, and any
                sharing suspension. Reports are stored separately from
                disappearing messages and are not deleted when a message is
                viewed. Report explanations are erased on resolution. Reports
                are scheduled for deletion 30 days after submission and removed
                by daily cleanup. Deleting either involved account removes the
                report immediately. For questions or a request about report
                data, contact{" "}
                <a className="underline" href="mailto:augie@luebbers.email">
                  augie@luebbers.email
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-xl font-semibold">
                3. How We Use Your Information
              </h2>
              <p className="mb-3">We use the information we collect to:</p>
              <ul className="ml-6 list-outside list-disc space-y-2">
                <li>Provide, maintain, and improve the whisp service</li>
                <li>Authenticate your identity and manage your account</li>
                <li>Deliver messages and media to your intended recipients</li>
                <li>Analyze usage patterns to improve user experience</li>
                <li>
                  Detect, prevent, and address technical issues and security
                  threats
                </li>
                <li>
                  Enforce our Terms of Service and protect against prohibited
                  conduct
                </li>
                <li>
                  Communicate with you about service updates and important
                  notices
                </li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-xl font-semibold">
                4. Data Storage and Deletion
              </h2>
              <p className="mb-3">
                whisp is built with privacy as a core principle. Here&apos;s how
                we handle your data:
              </p>

              <h3 className="mb-2 mt-4 text-lg font-semibold">
                4.1 Ephemeral Content
              </h3>
              <p>
                All photos and videos sent through whisp are automatically and
                permanently deleted from our servers immediately after they are
                viewed by the recipient. Once deleted, this content cannot be
                recovered by anyone, including whisp. We do not maintain backups
                of ephemeral content.
              </p>

              <h3 className="mb-2 mt-4 text-lg font-semibold">
                4.2 Account Data
              </h3>
              <p>
                Your account information (Discord username, user ID, email, and
                profile picture) is stored for as long as your account is
                active. You can delete your account at any time through the app
                settings. Deletion removes your Discord ID, credentials,
                profile, sessions, notification tokens, friendships, blocks,
                reports involving you, sent messages, and groups you created.
                Cloud files are queued for deletion, with daily retries if
                storage deletion fails. This does not delete your Discord
                account or other people&apos;s messages outside groups you
                created.
              </p>
              <p className="mt-3">
                For confirmed serious abuse, a human reviewer may find that a
                limited suspension must continue after deletion to prevent
                further serious harm. In those cases we may retain a keyed hash
                of your Discord ID, a decision reference, the reason and
                necessity finding, policy revision, decision date, and expiry.
                This is protected personal data, not anonymous data. We do not
                retain your raw Discord ID, profile, report text, or media in
                that record. This processing is subject to an approved
                legitimate-interests assessment and individual necessity review,
                including age and privacy interests. Reports alone do not
                justify it.
              </p>
              <p className="mt-3">
                The reviewer chooses the shortest justified suspension period.
                Deletion and signing in again never extend it. Enforcement ends
                at expiry, and daily cleanup removes the record. Contact
                augie@luebbers.email to learn the reason and expiry, appeal,
                request erasure, or object to retention without recreating your
                account. We assess such requests individually and explain the
                outcome.
              </p>

              <h3
                id="delete-account"
                className="mb-2 mt-4 scroll-mt-32 text-lg font-semibold"
              >
                4.3 Deleting Your Account
              </h3>
              <p className="mb-3">
                You can delete your whisp account and its data in either of two
                ways:
              </p>
              <ul className="ml-6 list-outside list-disc space-y-2">
                <li>
                  In the app, open Profile, tap Delete Account, and confirm.
                  Deletion happens immediately and signs you out.
                </li>
                <li>
                  Without the app, email{" "}
                  <a
                    href="mailto:augie@luebbers.email?subject=Delete%20my%20whisp%20account"
                    className="underline hover:text-foreground"
                  >
                    augie@luebbers.email
                  </a>{" "}
                  with the subject &quot;Delete my whisp account&quot; and your
                  Discord username. We will confirm that the account is yours,
                  for example by asking you to message us from that Discord
                  account, then delete it within 30 days and reply when it is
                  done.
                </li>
              </ul>
              <p className="mt-3">
                Either way, deletion removes the data described in section 4.2.
                Cloud files are deleted by a daily job, with retries if storage
                deletion fails. The only data that may remain is the limited
                suspension record described in section 4.2, and only after a
                human review of confirmed serious abuse.
              </p>

              <h3 className="mb-2 mt-4 text-lg font-semibold">
                4.4 Analytics and Usage Data
              </h3>
              <p>
                Usage data and analytics are retained for a reasonable period to
                help us improve the service. This data is aggregated and
                anonymized where possible.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-xl font-semibold">
                5. Third-Party Services
              </h2>
              <p className="mb-3">
                whisp uses Discord for authentication. When you sign in with
                Discord, you are subject to Discord&apos;s Privacy Policy and
                Terms of Service. We encourage you to review Discord&apos;s
                privacy practices. We do not share your information with any
                other third parties except as necessary to provide the service
                or as required by law.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-xl font-semibold">
                6. Children&apos;s Privacy
              </h2>
              <p>
                whisp is intended for users who are at least 13 years of age. We
                do not knowingly collect personal information from children
                under 13. If we become aware that a user is under 13, we will
                terminate their account and delete their information. If you
                believe a child under 13 has provided us with personal
                information, please contact us through our Discord server.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-xl font-semibold">7. Data Security</h2>
              <p>
                We implement appropriate technical and organizational security
                measures to protect your information against unauthorized
                access, alteration, disclosure, or destruction. However, no
                method of transmission over the internet or electronic storage
                is 100% secure. While we strive to protect your personal
                information, we cannot guarantee its absolute security.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-xl font-semibold">8. Your Rights</h2>
              <p className="mb-3">
                Depending on your location, you may have certain rights
                regarding your personal information, including:
              </p>
              <ul className="ml-6 list-outside list-disc space-y-2">
                <li>
                  The right to access the personal information we hold about you
                </li>
                <li>
                  The right to request correction of inaccurate information
                </li>
                <li>
                  The right to request deletion of your personal information
                </li>
                <li>
                  The right to object to or restrict certain processing of your
                  information
                </li>
                <li>
                  The right to opt out of certain data collection practices
                </li>
              </ul>
              <p className="mt-3">
                You can exercise your right to deletion at any time, with or
                without the app. See{" "}
                <a
                  href="#delete-account"
                  className="underline hover:text-foreground"
                >
                  section 4.3
                </a>{" "}
                for how. For other requests, email augie@luebbers.email or
                contact us through our Discord server. We will respond to your
                request within a reasonable timeframe.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-xl font-semibold">
                9. International Data Transfers
              </h2>
              <p>
                Your information may be transferred to and processed in
                countries other than your country of residence. These countries
                may have data protection laws that are different from the laws
                of your country. By using whisp, you consent to the transfer of
                your information to these countries.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-xl font-semibold">
                10. Changes to This Privacy Policy
              </h2>
              <p>
                We may update this Privacy Policy from time to time. We will
                notify you of any material changes by posting the new Privacy
                Policy on this page and updating the &quot;Last Updated&quot;
                date. Your continued use of whisp after such changes constitutes
                your acceptance of the updated Privacy Policy.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-xl font-semibold">11. Contact Us</h2>
              <p>
                If you have any questions about this Privacy Policy or our data
                practices, please contact us through our{" "}
                <a
                  href={URLS.DISCORD}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Discord server
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
      <div className="fixed bottom-4 right-4 z-50">
        <ThemeToggle />
      </div>
    </div>
  );
}
