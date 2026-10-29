package com.pos2013.offline.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import com.pos2013.offline.PosApplication
import com.pos2013.offline.data.TransactionRepository
import com.pos2013.offline.data.api.*
import kotlinx.coroutines.launch

typealias LD<T> = LiveData<T>
typealias MLD<T> = MutableLiveData<T>

sealed class UiState<out T> {
    object Idle : UiState<Nothing>()
    object Loading : UiState<Nothing>()
    data class Success<out T>(val data: T) : UiState<T>()
    data class Error(val message: String) : UiState<Nothing>()
}

fun <T> MLD<UiState<T>>.loading() { postValue(UiState.Loading) }
fun <T> MLD<UiState<T>>.success(data: T) { postValue(UiState.Success(data)) }
fun <T> MLD<UiState<T>>.error(msg: String) { postValue(UiState.Error(msg)) }

inline fun <T> UiState<T>.fold(
    idle: () -> Unit = {},
    loading: () -> Unit = {},
    success: (T) -> Unit,
    error: (String) -> Unit = {}
) {
    when (this) {
        UiState.Idle -> idle()
        UiState.Loading -> loading()
        is UiState.Success -> success(data)
        is UiState.Error -> error(message)
    }
}

open class BaseViewModel(app: Application) : AndroidViewModel(app) {
    protected val repo: TransactionRepository = (app as PosApplication).repository
    protected val appCtx = app.applicationContext!!
}

// ── Login ────────────────────────────────────────────────────────────────────
class LoginViewModel(app: Application) : BaseViewModel(app) {
    private val _loginState = MLD<UiState<Pair<String, UserDto?>>>()
    val loginState: LD<UiState<Pair<String, UserDto?>>> = _loginState

    fun login(username: String, password: String) = viewModelScope.launch {
        if (username.isBlank() || password.isBlank()) {
            _loginState.error("Enter username and password"); return@launch
        }
        _loginState.loading()
        try {
            val r = repo.login(username, password)
            if (r?.token != null) {
                _loginState.success(r.token to r.user)
            } else {
                _loginState.error(r?.message ?: "Login failed")
            }
        } catch (t: Throwable) {
            _loginState.error(t.message ?: "Network error")
        }
    }
}

// ── Dashboard ────────────────────────────────────────────────────────────────
class DashboardViewModel(app: Application) : BaseViewModel(app) {
    private val _stats = MLD<UiState<DashboardStats>>()
    val stats: LD<UiState<DashboardStats>> = _stats
    private val _pending = MLD<Int>(0)
    val pendingCount: LD<Int> = _pending

    fun refresh(merchantId: String? = null, currency: String = PosApplication.getCurrency(appCtx)) = viewModelScope.launch {
        _stats.loading()
        try {
            val s = repo.getDashboardStats(merchantId, currency)
            if (s != null) _stats.success(s) else _stats.error("No dashboard data available")
        } catch (t: Throwable) {
            _stats.error(t.message ?: "Failed to load dashboard")
        }
    }

    fun refreshPendingCount() = viewModelScope.launch {
        try { _pending.postValue(repo.getPendingCount()) } catch (_: Throwable) {}
    }
}

// ── Charge (101.1 / 101.6 / 201.3) ──────────────────────────────────────────
class ChargeViewModel(app: Application) : BaseViewModel(app) {
    private val _chargeResult = MLD<UiState<PosChargeResponse>>()
    val chargeResult: LD<UiState<PosChargeResponse>> = _chargeResult

    private val _voiceResult = MLD<UiState<VoiceAuthResponse>>()
    val voiceResult: LD<UiState<VoiceAuthResponse>> = _voiceResult

    private val _verifyResult = MLD<UiState<VerifyTransactionResponse>>()
    val verifyResult: LD<UiState<VerifyTransactionResponse>> = _verifyResult

    fun chargeOnline(req: PosChargeRequest) = viewModelScope.launch {
        _chargeResult.loading()
        try {
            val r = repo.chargeOnline(req)
            if (r != null && r.success) _chargeResult.success(r)
            else _chargeResult.error(r?.error ?: r?.reason ?: "Charge declined")
        } catch (t: Throwable) {
            _chargeResult.error(t.message ?: "Charge failed")
        }
    }

    fun voiceAuth(req: VoiceAuthRequest) = viewModelScope.launch {
        _voiceResult.loading()
        try {
            val r = repo.voiceAuth(req)
            if (r != null && r.success) _voiceResult.success(r)
            else _voiceResult.error(r?.error ?: r?.message ?: "Voice auth declined")
        } catch (t: Throwable) {
            _voiceResult.error(t.message ?: "Voice auth failed")
        }
    }

    fun verify(req: VerifyTransactionRequest) = viewModelScope.launch {
        _verifyResult.loading()
        try {
            val r = repo.verifyTxn(req)
            if (r != null) _verifyResult.success(r) else _verifyResult.error("Verification failed")
        } catch (t: Throwable) {
            _verifyResult.error(t.message ?: "Verification failed")
        }
    }

    fun createOfflineTx(
        merchantId: String, terminalId: String, amountMinor: Long, currency: String,
        panMasked: String, expiry: String, stan: String,
        entryMode: String = "MANUAL", txnType: String = "SALE",
        authMode: String = "OFFLINE_APPROVED", approvalCode: String? = null,
        protocol: String? = "201.3", emvData: String? = null
    ) = viewModelScope.launch {
        try {
            repo.createOfflineTransaction(
                merchantId, terminalId, amountMinor, currency, panMasked, expiry,
                stan, entryMode, txnType, authMode, approvalCode, protocol, emvData
            )
        } catch (_: Throwable) {}
    }
}

// ── Sync ─────────────────────────────────────────────────────────────────────
class SyncViewModel(app: Application) : BaseViewModel(app) {
    private val _syncState = MLD<UiState<com.pos2013.offline.data.SyncResult>>()
    val syncState: LD<UiState<com.pos2013.offline.data.SyncResult>> = _syncState

    fun sync() = viewModelScope.launch {
        _syncState.loading()
        try {
            val r = repo.syncPendingTransactions()
            if (r.success) _syncState.success(r) else _syncState.error(r.errorMessage ?: "Sync failed")
        } catch (t: Throwable) {
            _syncState.error(t.message ?: "Sync failed")
        }
    }
}

// ── Wallet ops ───────────────────────────────────────────────────────────────
class WalletViewModel(app: Application) : BaseViewModel(app) {
    private val _balance = MLD<UiState<WalletBalanceResponse>>()
    val balance: LD<UiState<WalletBalanceResponse>> = _balance
    private val _topup = MLD<UiState<WalletTopupResponse>>()
    val topup: LD<UiState<WalletTopupResponse>> = _topup
    private val _transfer = MLD<UiState<WalletTransferResponse>>()
    val transfer: LD<UiState<WalletTransferResponse>> = _transfer
    private val _txList = MLD<UiState<List<WalletTransactionDto>>>()
    val txList: LD<UiState<List<WalletTransactionDto>>> = _txList

    fun loadCustomerBalance(customerId: String) = viewModelScope.launch {
        _balance.loading()
        try {
            val r = repo.walletBalance(customerId)
            if (r != null) _balance.success(r) else _balance.error("No wallet found")
        } catch (t: Throwable) { _balance.error(t.message ?: "Load failed") }
    }

    fun loadMerchantBalance(merchantId: String, currency: String = "USD") = viewModelScope.launch {
        _balance.loading()
        try {
            val r = repo.merchantBalance(merchantId, currency)
            if (r != null) _balance.success(r) else _balance.error("No merchant wallet")
        } catch (t: Throwable) { _balance.error(t.message ?: "Load failed") }
    }

    fun topup(req: WalletTopupRequest) = viewModelScope.launch {
        _topup.loading()
        try {
            val r = repo.topupWithCard(req)
            if (r != null && r.success) _topup.success(r) else _topup.error(r?.error ?: "Topup declined")
        } catch (t: Throwable) { _topup.error(t.message ?: "Topup failed") }
    }

    fun transferInternal(req: WalletTransferRequest) = viewModelScope.launch {
        _transfer.loading()
        try {
            val r = repo.transferInternal(req)
            if (r != null && r.success) _transfer.success(r) else _transfer.error(r?.error ?: r?.message ?: "Transfer declined")
        } catch (t: Throwable) { _transfer.error(t.message ?: "Transfer failed") }
    }

    fun sendToMerchant(req: WalletTransferRequest) = viewModelScope.launch {
        _transfer.loading()
        try {
            val r = repo.sendCustomerToMerchant(req)
            if (r != null && r.success) _transfer.success(r) else _transfer.error(r?.error ?: r?.message ?: "Transfer declined")
        } catch (t: Throwable) { _transfer.error(t.message ?: "Transfer failed") }
    }

    fun listCustomerTx(customerId: String) = viewModelScope.launch {
        _txList.loading()
        try {
            val r = repo.walletTransactions(customerId)
            _txList.success(r)
        } catch (t: Throwable) { _txList.error(t.message ?: "Load failed") }
    }

    fun listMerchantTx(merchantId: String, limit: Int = 200) = viewModelScope.launch {
        _txList.loading()
        try {
            val r = repo.merchantWalletTransactions(merchantId, limit)
            _txList.success(r)
        } catch (t: Throwable) { _txList.error(t.message ?: "Load failed") }
    }
}

// ── ReportRun + aliases to match activity DTO references ────────────────────
data class ReportRunDto(
    val id: String,
    val reportType: String? = null,
    val status: String? = null,
    val dayRange: Int? = null,
    val recordsCount: Int? = null,
    val format: String? = null,
    val generatedBy: String? = null,
    val generatedAt: String? = null,
    val downloadUrl: String? = null,
    val merchantId: String? = null
)

typealias AuditEventDto = AuditTrailDto
typealias ReconDto = ReconciliationDto

// ── Batches / settlements / transactions / verify ────────────────────────────
class OperationsViewModel(app: Application) : BaseViewModel(app) {
    private val _batches = MLD<UiState<List<BatchDto>>>()
    val batches: LD<UiState<List<BatchDto>>> = _batches
    private val _settlements = MLD<UiState<List<SettlementDto>>>()
    val settlements: LD<UiState<List<SettlementDto>>> = _settlements
    private val _txs = MLD<UiState<List<TransactionDto>>>()
    val transactions: LD<UiState<List<TransactionDto>>> = _txs
    private val _closeBatch = MLD<UiState<CloseBatchResponse>>()
    val closeBatchState: LD<UiState<CloseBatchResponse>> = _closeBatch
    private val _verify = MLD<UiState<VerifyTransactionResponse>>()
    val verifyState: LD<UiState<VerifyTransactionResponse>> = _verify

    fun loadBatches(merchantId: String? = null, status: String? = null) = viewModelScope.launch {
        _batches.loading()
        try { _batches.success(repo.listBatches(merchantId, status)) }
        catch (t: Throwable) { _batches.error(t.message ?: "Failed") }
    }

    fun closeBatch(id: String, force: Boolean = false) = viewModelScope.launch {
        _closeBatch.loading()
        try {
            val r = repo.closeBatch(id, force)
            if (r != null && r.success) _closeBatch.success(r) else _closeBatch.error(r?.message ?: r?.error ?: "Close failed")
        } catch (t: Throwable) { _closeBatch.error(t.message ?: "Close failed") }
    }

    fun loadSettlements(merchantId: String? = null, status: String? = null, from: String? = null, to: String? = null, limit: Int = 100) = viewModelScope.launch {
        _settlements.loading()
        try { _settlements.success(repo.listSettlements(merchantId, status, from, to, limit)) }
        catch (t: Throwable) { _settlements.error(t.message ?: "Failed") }
    }

    fun loadTransactions(
        merchantId: String? = null, terminalId: String? = null, status: String? = null,
        protocol: String? = null, from: String? = null, to: String? = null, limit: Int = 200,
        batchId: String? = null
    ) = viewModelScope.launch {
        _txs.loading()
        try {
            var list = repo.listTransactions(merchantId, terminalId, status, protocol, from, to, limit)
            if (batchId != null) {
                list = list.filter { it.batchId == batchId }
            }
            _txs.success(list)
        } catch (t: Throwable) { _txs.error(t.message ?: "Failed") }
    }

    fun verifyTransaction(
        approvalCode: String? = null, stan: String? = null, rrn: String? = null, transactionId: String? = null
    ) = viewModelScope.launch {
        _verify.loading()
        try {
            val r = repo.verifyTxn(VerifyTransactionRequest(authCode = approvalCode, stan = stan, rrn = rrn, transactionId = transactionId))
            if (r != null) _verify.success(r) else _verify.error("Not found")
        } catch (t: Throwable) { _verify.error(t.message ?: "Verification failed") }
    }
}

// ── Finance / Wallets / Receipts / Customers / Products / Terminals/Pairing ─
class FinanceViewModel(app: Application) : BaseViewModel(app) {
    // Receipts
    private val _receipts = MLD<UiState<List<ReceiptDto>>>()
    val receipts: LD<UiState<List<ReceiptDto>>> = _receipts

    // Wallets
    private val _walletBalances = MLD<UiState<List<WalletBalanceResponse>>>()
    val walletBalances: LD<UiState<List<WalletBalanceResponse>>> = _walletBalances
    private val _walletTx = MLD<UiState<List<WalletTransactionDto>>>()
    val walletTx: LD<UiState<List<WalletTransactionDto>>> = _walletTx
    private val _walletTransfer = MLD<UiState<WalletTransferResponse>>()
    val walletTransferState: LD<UiState<WalletTransferResponse>> = _walletTransfer

    // Customers
    private val _customers = MLD<UiState<List<CustomerDto>>>()
    val customers: LD<UiState<List<CustomerDto>>> = _customers

    // Products / inventory
    private val _products = MLD<UiState<List<ProductDto>>>()
    val products: LD<UiState<List<ProductDto>>> = _products

    // Terminals / pairing
    private val _terminals = MLD<UiState<List<TerminalDto>>>()
    val terminals: LD<UiState<List<TerminalDto>>> = _terminals
    private val _register = MLD<UiState<TerminalRegisterResponse>>()
    val registerState: LD<UiState<TerminalRegisterResponse>> = _register
    private val _pairing = MLD<UiState<TerminalPairingResponse>>()
    val pairingState: LD<UiState<TerminalPairingResponse>> = _pairing

    // ── Receipts ──────────────────────────────────────────────────────────────
    fun loadReceipts(merchantId: String? = null, txnId: String? = null, limit: Int = 100) = viewModelScope.launch {
        _receipts.loading()
        try { _receipts.success(repo.listReceipts(merchantId, txnId, limit)) }
        catch (t: Throwable) { _receipts.error(t.message ?: "Failed") }
    }

    // ── Wallets ───────────────────────────────────────────────────────────────
    fun loadWalletBalances(merchantId: String? = null, customerId: String? = null) = viewModelScope.launch {
        _walletBalances.loading()
        try {
            val currencies = listOf("USD", "PHP", "AED", "EUR", "GBP")
            val out = mutableListOf<WalletBalanceResponse>()
            if (merchantId != null) {
                for (c in currencies) {
                    try { repo.merchantBalance(merchantId, c)?.let { out.add(it) } } catch (_: Throwable) {}
                }
            } else {
                val list = if (customerId == "ALL") emptyList() else (customerId?.let { id ->
                    repo.customerWallets(id).mapNotNull { cw ->
                        repo.walletBalance(cw.customerId ?: return@mapNotNull null)
                    }
                } ?: emptyList())
                out.addAll(list)
            }
            _walletBalances.success(out)
        } catch (t: Throwable) { _walletBalances.error(t.message ?: "Failed") }
    }

    fun loadWalletTransactions(merchantId: String? = null, customerId: String? = null, limit: Int = 200) = viewModelScope.launch {
        _walletTx.loading()
        try {
            val list = when {
                merchantId != null -> repo.merchantWalletTransactions(merchantId, limit)
                customerId != null && customerId != "ALL" -> repo.walletTransactions(customerId)
                else -> emptyList()
            }
            _walletTx.success(list)
        } catch (t: Throwable) { _walletTx.error(t.message ?: "Failed") }
    }

    fun setRuntimeCreds(endpointUrl: String, apiKey: String) = viewModelScope.launch {
        try { repo.runtimeFundProviderCredsSet(endpointUrl, apiKey) } catch (_: Throwable) {}
    }

    fun transfer(
        fromMerchant: String? = null, fromCustomer: String? = null,
        toMerchant: String? = null, toWalletCode: String? = null,
        amount: Double, currency: String, reference: String? = null,
        endpoint: String? = null, apiKey: String? = null
    ) = viewModelScope.launch {
        _walletTransfer.loading()
        try {
            endpoint?.let { e -> apiKey?.let { k -> repo.runtimeFundProviderCredsSet(e, k) } }
            val runtime = if (endpoint != null || apiKey != null) FundProviderCredsDto(endpoint, apiKey) else null
            val req = WalletTransferRequest(
                fromMerchantId = fromMerchant,
                fromCustomerId = fromCustomer,
                toMerchantId = toMerchant,
                toWalletCode = toWalletCode,
                amount = amount,
                currency = currency,
                reference = reference,
                fundProviderEndpoint = endpoint,
                fundProviderApiKey = apiKey,
                runtimeFundProviderCreds = runtime
            )
            val r = if (fromCustomer != null && toMerchant != null) repo.sendCustomerToMerchant(req) else repo.transferInternal(req)
            if (r != null && r.success) _walletTransfer.success(r)
            else _walletTransfer.error(r?.error ?: r?.message ?: "Transfer failed")
        } catch (t: Throwable) { _walletTransfer.error(t.message ?: "Transfer failed") }
    }

    // ── Customers ─────────────────────────────────────────────────────────────
    fun loadCustomers(merchantId: String? = null) = viewModelScope.launch {
        _customers.loading()
        try { _customers.success(repo.listCustomers(null)) }
        catch (t: Throwable) { _customers.error(t.message ?: "Failed") }
    }

    fun createCustomer(name: String, email: String? = null, phone: String? = null, company: String? = null): CustomerDto? {
        var out: CustomerDto? = null
        viewModelScope.launch {
            try { out = repo.createCustomer(CreateCustomerRequest(name = name, email = email, phone = phone, company = company)) }
            catch (_: Throwable) {}
        }
        return out
    }

    fun topupCustomer(customerId: String, walletCode: String?, amount: Double, currency: String) = viewModelScope.launch {
        try {
            repo.topupWithCard(WalletTopupRequest(
                customerId = customerId,
                walletCode = walletCode,
                amount = amount,
                source = "card"
            ))
        } catch (_: Throwable) {}
    }

    // ── Products / inventory ──────────────────────────────────────────────────
    fun loadProducts(merchantId: String? = null, q: String? = null, category: String? = null) = viewModelScope.launch {
        _products.loading()
        try { _products.success(repo.listProducts(merchantId, q, category)) }
        catch (t: Throwable) { _products.error(t.message ?: "Failed") }
    }

    fun upsertProduct(
        id: String?, name: String, sku: String?, category: String?, price: Double,
        stockQty: Int, currency: String, barcode: String?
    ) = viewModelScope.launch {
        try {
            val p = ProductDto(
                id = id ?: ("new_" + System.currentTimeMillis()),
                merchantId = null,
                sku = sku,
                name = name,
                category = category,
                price = price,
                stockQty = stockQty,
                currency = currency,
                barcode = barcode,
                description = null,
                imageUrl = null,
                taxRate = null,
                cost = null,
                status = "ACTIVE",
                createdAt = null,
                updatedAt = null
            )
            if (id == null) repo.createProduct(p) else repo.updateProduct(id, p)
            _products.success(repo.listProducts(null, null, null))
        } catch (_: Throwable) {}
    }

    fun adjustStock(productIdOrSku: String, delta: Int, note: String?) = viewModelScope.launch {
        try {
            repo.inventoryAdjust(productIdOrSku, delta, note ?: "manual")
        } catch (_: Throwable) {}
    }

    // ── Terminals ─────────────────────────────────────────────────────────────
    fun loadTerminals(merchantId: String? = null, status: String? = null) = viewModelScope.launch {
        _terminals.loading()
        try { _terminals.success(repo.listTerminals(merchantId, status)) }
        catch (t: Throwable) { _terminals.error(t.message ?: "Failed") }
    }

    fun registerTerminal(name: String, serial: String?) = viewModelScope.launch {
        _register.loading()
        try {
            val r = repo.registerTerminal(name, serial)
            if (r != null) _register.success(r) else _register.error("Registration failed")
        } catch (t: Throwable) { _register.error(t.message ?: "Registration failed") }
    }

    fun pairTerminal(pairingCode: String, terminalId: String, merchantId: String) = viewModelScope.launch {
        _pairing.loading()
        try {
            val pairApi = com.pos2013.offline.data.api.ApiClient.fromApp(appCtx).terminals
            val resp = pairApi.pairTerminal(terminalId, TerminalPairingRequest(pairingCode, terminalId, merchantId))
            val body = resp.body()
            if (resp.isSuccessful && body != null) {
                if (body.success == true) {
                    _pairing.success(body)
                } else {
                    _pairing.error(body.message ?: "Pairing failed")
                }
            } else {
                _pairing.error("Pairing failed: HTTP " + resp.code())
            }
        } catch (t: Throwable) { _pairing.error(t.message ?: "Pairing failed") }
    }
}

// ── Hot / Crypto / Payouts / Vault / Virtual Cards / Audit / Recon / Reports / PMs
class GovernanceViewModel(app: Application) : BaseViewModel(app) {
    private val _hot = MLD<UiState<List<HotWalletDto>>>()
    val hotWallets: LD<UiState<List<HotWalletDto>>> = _hot
    private val _crypto = MLD<UiState<List<CryptoWalletDto>>>()
    val cryptoWallets: LD<UiState<List<CryptoWalletDto>>> = _crypto
    private val _payouts = MLD<UiState<List<PayoutDto>>>()
    val payouts: LD<UiState<List<PayoutDto>>> = _payouts
    private val _vault = MLD<UiState<List<VaultAccountDto>>>()
    val vaultAccounts: LD<UiState<List<VaultAccountDto>>> = _vault
    private val _vCards = MLD<UiState<List<VirtualCardDto>>>()
    val virtualCards: LD<UiState<List<VirtualCardDto>>> = _vCards
    private val _audit = MLD<UiState<List<AuditEventDto>>>()
    val auditEvents: LD<UiState<List<AuditEventDto>>> = _audit
    private val _recon = MLD<UiState<List<ReconDto>>>()
    val recons: LD<UiState<List<ReconDto>>> = _recon
    private val _reports = MLD<UiState<List<ReportRunDto>>>()
    val reports: LD<UiState<List<ReportRunDto>>> = _reports
    private val _paymentMethods = MLD<UiState<List<PaymentMethodDto>>>()
    val paymentMethods: LD<UiState<List<PaymentMethodDto>>> = _paymentMethods

    fun loadHotWallets() = viewModelScope.launch {
        _hot.loading(); try { _hot.success(repo.listHotWallets()) }
        catch (t: Throwable) { _hot.error(t.message ?: "Failed") }
    }

    fun loadCryptoWallets(ownerId: String? = null, ownerType: String? = null) = viewModelScope.launch {
        _crypto.loading(); try { _crypto.success(repo.listCryptoWallets(ownerId, ownerType)) }
        catch (t: Throwable) { _crypto.error(t.message ?: "Failed") }
    }

    fun loadPayouts(merchantId: String? = null, status: String? = null, method: String? = null) = viewModelScope.launch {
        _payouts.loading(); try { _payouts.success(repo.listPayouts(merchantId, status, method)) }
        catch (t: Throwable) { _payouts.error(t.message ?: "Failed") }
    }

    fun submitPayout(
        beneficiary: String, bankOrChain: String?, account: String?,
        amount: Double, currency: String, reference: String?
    ) = viewModelScope.launch {
        try {
            repo.createBankPayout(BankPayoutRequest(
                merchantId = (appCtx as? PosApplication)?.let { PosApplication.getMerchantId(it) },
                beneficiaryId = beneficiary,
                amount = amount,
                currency = currency,
                reference = reference,
                purpose = null
            ))
            loadPayouts()
        } catch (_: Throwable) {}
    }

    fun loadVaultAccounts() = viewModelScope.launch {
        _vault.loading(); try { _vault.success(repo.listVaultAccounts()) }
        catch (t: Throwable) { _vault.error(t.message ?: "Failed") }
    }

    fun loadVirtualCards(ownerId: String? = null, ownerType: String? = null, status: String? = null) = viewModelScope.launch {
        _vCards.loading(); try { _vCards.success(repo.listVirtualCards(ownerId, ownerType, status)) }
        catch (t: Throwable) { _vCards.error(t.message ?: "Failed") }
    }

    fun issueVirtualCard(
        customerId: String?, brand: String, currency: String,
        spendLimit: Double?, label: String?
    ) = viewModelScope.launch {
        try {
            val merchantId = (appCtx as? PosApplication)?.let { PosApplication.getMerchantId(it) }
            val ownerType = if (customerId != null) "CUSTOMER" else "MERCHANT"
            val ownerIdVal = customerId ?: merchantId ?: ""
            val r = repo.createVirtualCard(CreateVirtualCardRequest(
                ownerId = ownerIdVal, ownerType = ownerType,
                brand = brand, currency = currency,
                spendingLimit = spendLimit,
                cardholderName = label ?: "Cardholder"
            ))
            if (r != null) loadVirtualCards()
        } catch (_: Throwable) {}
    }

    fun toggleVirtualCard(id: String, active: Boolean) = viewModelScope.launch {
        try { if (active) repo.unfreezeVirtualCard(id) else repo.freezeVirtualCard(id) }
        catch (_: Throwable) {}
    }

    fun terminateVirtualCard(id: String) = viewModelScope.launch {
        try {
            // Most endpoints expose freeze/unfreeze. Terminate = attempt freeze + status update.
            repo.freezeVirtualCard(id)
            loadVirtualCards()
        } catch (_: Throwable) {}
    }

    fun loadAuditEvents(merchantId: String? = null, actor: String? = null, action: String? = null, limit: Int = 500) = viewModelScope.launch {
        _audit.loading(); try { _audit.success(repo.auditTrail(actorId = actor, action = action, limit = limit)) }
        catch (t: Throwable) { _audit.error(t.message ?: "Failed") }
    }

    fun loadRecons(merchantId: String? = null, from: String? = null, to: String? = null, limit: Int = 100) = viewModelScope.launch {
        _recon.loading(); try { _recon.success(repo.reconciliationReports(from, to, limit)) }
        catch (t: Throwable) { _recon.error(t.message ?: "Failed") }
    }

    fun loadReports(merchantId: String? = null) = viewModelScope.launch {
        _reports.loading()
        try {
            val list = mutableListOf<ReportRunDto>()
            // Build synthetic list from today + yesterday daily reports (placeholder until backend has list endpoint)
            val currencies = listOf("USD", "PHP", "AED", "EUR", "GBP")
            var i = 0
            for (c in currencies) {
                try {
                    val rep = repo.dailyReport(null, merchantId, c) ?: continue
                    i++
                    list.add(ReportRunDto(
                        id = "daily_${c}_${i}",
                        reportType = "DAILY",
                        status = "READY",
                        dayRange = 1,
                        recordsCount = rep.txCount,
                        format = "CSV",
                        generatedBy = "system",
                        generatedAt = rep.generatedAt,
                        downloadUrl = null,
                        merchantId = merchantId
                    ))
                } catch (_: Throwable) {}
            }
            _reports.success(list)
        } catch (t: Throwable) { _reports.error(t.message ?: "Failed") }
    }

    fun generateReport(days: Int, format: String) = viewModelScope.launch {
        try {
            val currency = PosApplication.getCurrency(appCtx)
            val rep = repo.dailyReport(null, null, currency)
            loadReports()
        } catch (_: Throwable) {}
    }

    fun loadPaymentMethods(merchantId: String? = null) = viewModelScope.launch {
        _paymentMethods.loading(); try { _paymentMethods.success(repo.listPaymentMethods()) }
        catch (t: Throwable) { _paymentMethods.error(t.message ?: "Failed") }
    }

    fun setPaymentMethodEnabled(id: String, enabled: Boolean) = viewModelScope.launch {
        // No dedicated toggle endpoint on the single-shot list call; re-run to refresh view
        try { loadPaymentMethods() } catch (_: Throwable) {}
    }
}
