/**
 * Mail abstraction for GIJIRO.
 *
 * Providers:
 *   console  (default, NODE_ENV=test or MAIL_PROVIDER=console)
 *             — prints JSON to stdout. No network calls. Used in dev/test.
 *   sendgrid  (MAIL_PROVIDER=sendgrid + SENDGRID_API_KEY)
 *             — calls SendGrid REST v3 via Node built-in fetch.
 *             No npm dep added. 200/202 treated as success.
 *
 * U-6 (email verification) will call send() / sendVerification() from this
 * same module. Add new sendXxx helpers here to keep all mail in one place.
 */

const provider = process.env.MAIL_PROVIDER || 'console';

/**
 * Low-level send. All helpers funnel through here.
 *
 * @param {{ to: string, subject: string, html: string, text: string }} opts
 * @returns {Promise<{ ok: boolean }>}
 */
async function send({ to, subject, html, text }) {
    if (provider === 'console') {
        console.log('[mail:console]', JSON.stringify({ to, subject, text }, null, 2));
        return { ok: true };
    }

    if (provider === 'sendgrid') {
        const apiKey = process.env.SENDGRID_API_KEY;
        if (!apiKey) throw new Error('SENDGRID_API_KEY not set');

        const from = process.env.MAIL_FROM || 'noreply@gijiro.app';

        const body = JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: { email: from },
            subject,
            content: [
                { type: 'text/plain', value: text },
                { type: 'text/html', value: html }
            ]
        });

        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body
        });

        // SendGrid returns 202 Accepted on success
        if (res.status === 200 || res.status === 202) {
            return { ok: true };
        }

        const errText = await res.text().catch(() => '(no body)');
        throw new Error(`SendGrid error ${res.status}: ${errText}`);
    }

    throw new Error(`unknown MAIL_PROVIDER: ${provider}`);
}

/**
 * パスワードリセットメール。
 * U-1 (password reset) から呼ばれる。
 *
 * @param {{ email: string }} account
 * @param {string} resetUrl  完全な https://<HOST>/auth/reset?token=<TOKEN>
 */
async function sendPasswordReset(account, resetUrl) {
    return send({
        to: account.email,
        subject: 'GIJIRO パスワードリセットのご案内',
        text: [
            '以下のリンクからパスワードをリセットしてください (1 時間有効):',
            resetUrl,
            '',
            'このメールに心当たりがない場合は破棄してください。'
        ].join('\n'),
        html: [
            '<p>以下のリンクからパスワードをリセットしてください (1 時間有効):</p>',
            `<p><a href="${resetUrl}">${resetUrl}</a></p>`,
            '<p>このメールに心当たりがない場合は破棄してください。</p>'
        ].join('')
    });
}

module.exports = { send, sendPasswordReset };
