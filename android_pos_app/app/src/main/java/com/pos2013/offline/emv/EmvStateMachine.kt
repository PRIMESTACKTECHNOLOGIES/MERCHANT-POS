package com.pos2013.offline.emv

enum class EmvState {
    INIT,
    READ_APPLICATION,
    DATA_AUTHENTICATION,
    PROCESS_RESTRICTIONS,
    CARDHOLDER_VERIFICATION,
    TERMINAL_RISK_MANAGEMENT,
    ACTION_ANALYSIS,
    ONLINE_PROCESSING,
    ISSUER_RESPONSE,
    COMPLETION
}

enum class EmvDecision {
    APPROVE,
    DECLINE,
    ONLINE
}

data class EmvContext(
    val state: EmvState = EmvState.INIT,
    val amountMinor: Long = 0,
    val currency: String = "0840",
    val merchantId: String = "",
    val terminalId: String = "",
    var pan: String? = null,
    var expiry: String? = null,
    var track2: String? = null,
    var field55Hex: String? = null,
    var arqcHex: String? = null,
    var arpcHex: String? = null,
    var atcHex: String? = null,
    var authCode: String? = null,
    var responseCode: String? = null,
    var decision: EmvDecision? = null,
    var scripts: List<String> = emptyList(),
    var tvr: Int = 0,
    var tsi: Int = 0,
    var error: String? = null
)

object EmvStateMachine {
    fun transition(ctx: EmvContext, s: EmvState) = ctx.copy(state = s)

    fun isTerminal(ctx: EmvContext) = ctx.decision != null && ctx.state == EmvState.COMPLETION

    fun processIssuerResponse(ctx: EmvContext, arc: String, scripts: List<String>) = ctx.copy(
        state = EmvState.COMPLETION,
        responseCode = arc,
        scripts = scripts,
        decision = if (arc == "00") EmvDecision.APPROVE else EmvDecision.DECLINE,
        tsi = ctx.tsi or (1 shl 13)
    )
}
