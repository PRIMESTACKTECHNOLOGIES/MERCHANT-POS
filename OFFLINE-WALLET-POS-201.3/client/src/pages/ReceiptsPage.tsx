import { useEffect, useState } from 'react';
import { fetchReceipts, generateReceipt, type Receipt } from '../lib/api';

export function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    loadReceipts();
  }, []);

  const loadReceipts = async () => {
    try {
      setLoading(true);
      const data = await fetchReceipts();
      setReceipts(data);
    } catch (error) {
      console.error('Failed to load receipts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReceipt = async (transactionId: string) => {
    try {
      const receipt = await generateReceipt(transactionId);
      setSelectedReceipt(receipt);
      loadReceipts(); // Refresh list
    } catch (error) {
      console.error('Failed to generate receipt:', error);
    }
  };

  const handlePrint = () => {
    if (selectedReceipt) {
      window.print();
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Receipts</h1>
        <p className="text-gray-600 mt-2">View and print transaction receipts</p>
      </div>

      {/* Receipts List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Recent Receipts</h2>
        </div>

        {receipts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-lg font-medium">No receipts yet</p>
            <p className="text-sm mt-1">Process transactions to generate receipts</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {receipts.map((receipt) => (
              <div
                key={receipt.receiptId}
                className="px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => setSelectedReceipt(receipt)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Receipt #{receipt.receiptId}</p>
                      <p className="text-sm text-gray-500">STAN: {receipt.stan}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">${receipt.amount}</p>
                    <p className="text-sm text-gray-500">{new Date(receipt.generatedAt).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Receipt Preview Modal */}
      {selectedReceipt && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-auto">
            {/* Receipt Content */}
            <div id="receipt-print" className="p-8 bg-white">
              <div className="text-center border-b-2 border-dashed border-gray-300 pb-4 mb-4">
                <h2 className="text-xl font-bold">{selectedReceipt.merchantInfo?.name || 'POS 201.3'}</h2>
                <p className="text-sm text-gray-600">{selectedReceipt.merchantInfo?.address}</p>
                <p className="text-xs text-gray-500 mt-1">Merchant ID: {selectedReceipt.merchantInfo?.id}</p>
              </div>

              <div className="text-center mb-4">
                <h3 className="text-lg font-bold">RECEIPT</h3>
                <p className="text-xs text-gray-500">{selectedReceipt.receiptId}</p>
              </div>

              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-gray-600">Date:</span>
                  <span>{new Date(selectedReceipt.transaction?.date || selectedReceipt.generatedAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">STAN:</span>
                  <span className="font-mono">{selectedReceipt.stan}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Terminal:</span>
                  <span>{selectedReceipt.transaction?.terminalId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Card:</span>
                  <span>{selectedReceipt.cardMasked}</span>
                </div>
              </div>

              <div className="border-t-2 border-dashed border-gray-300 py-4 mb-4">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-bold">TOTAL</span>
                  <span className="text-2xl font-bold">
                    ${selectedReceipt.amount} {selectedReceipt.currency}
                  </span>
                </div>
              </div>

              {selectedReceipt.transaction?.settlementCode && (
                <div className="bg-gray-100 p-3 rounded text-center mb-4">
                  <p className="text-xs text-gray-600">Settlement Code</p>
                  <p className="text-xl font-mono font-bold tracking-wider">
                    {selectedReceipt.transaction.settlementCode}
                  </p>
                </div>
              )}

              <div className="text-center text-xs text-gray-500 border-t border-dashed border-gray-300 pt-4">
                <p>{selectedReceipt.footer || 'Thank you for your business!'}</p>
                <p className="mt-1">Powered by POS 201.3</p>
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex space-x-3">
              <button
                onClick={handlePrint}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Print Receipt
              </button>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-medium hover:bg-gray-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
