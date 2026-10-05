import { useState, useEffect } from 'react';
import { fetchProducts, createProduct, type Product } from '../lib/api';
import { getErrorMessage } from '../utils/errorMessage';
import type { ReactNode } from 'react';

// Components
interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  color: string;
  subtext?: string;
}

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  minStock: number;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  lastUpdated: string;
}

function statusForStock(stock: number): ProductRow['status'] {
  if (stock === 0) return 'OUT_OF_STOCK';
  return stock < 10 ? 'LOW_STOCK' : 'IN_STOCK';
}

const StatCard = ({ title, value, icon, color, subtext }: StatCardProps) => (
  <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group">
    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity transform group-hover:scale-110 duration-500">
      {icon}
    </div>
    <div className="flex justify-between items-start mb-4 relative z-10">
      <div className="text-sm font-medium text-gray-500">{title}</div>
      <div className={`p-2 rounded-lg bg-opacity-10 transition-colors`} style={{ backgroundColor: `${color}15`, color: color }}>
        {icon}
      </div>
    </div>
    <div className="text-2xl font-bold text-gray-900 mb-1 relative z-10">{value}</div>
    {subtext && <div className="text-xs text-gray-500 relative z-10">{subtext}</div>}
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const styles = {
    IN_STOCK: 'bg-green-50 text-green-700 border-green-100',
    LOW_STOCK: 'bg-yellow-50 text-yellow-700 border-yellow-100',
    OUT_OF_STOCK: 'bg-red-50 text-red-700 border-red-100',
  };
  
  const labels = {
    IN_STOCK: 'In Stock',
    LOW_STOCK: 'Low Stock',
    OUT_OF_STOCK: 'Out of Stock',
  };

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800'}`}>
      {labels[status as keyof typeof labels] || status}
    </span>
  );
};

export const InventoryPage = () => {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL'); // ALL, LOW_STOCK, OUT_OF_STOCK
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', sku: '', price: '', stock: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetchProducts();
        if (!mounted) return;
        // Map API product to UI shape
        const mapped = res.map((p: Product) => ({
          id: p.id,
          name: p.name,
          sku: p.sku || '',
          category: '',
          price: (p.price_minor || 0) / 100,
          stock: p.stock || 0,
          minStock: 10,
          status: statusForStock(p.stock || 0),
          lastUpdated: p.updated_at || new Date().toISOString()
        }));
        setProducts(mapped);
      } catch (e) {
        console.error('Failed to load products', e);
      } finally {
        setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  const filteredProducts = products.filter(p => {
    const matchesFilter = filter === 'ALL' || p.status === filter;
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          p.sku.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const totalValue = products.reduce((acc, p) => acc + ((Number(p.price) || 0) * (p.stock || 0)), 0);
  const lowStockCount = products.filter(p => p.status === 'LOW_STOCK').length;
  const outOfStockCount = products.filter(p => p.status === 'OUT_OF_STOCK').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="flex flex-col items-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <div className="text-sm text-gray-500 font-medium">Loading Inventory...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Inventory Management</h1>
          <p className="text-sm text-gray-500 mt-1">Track stock levels and product catalog</p>
        </div>
        <button
          onClick={() => { setNewProduct({ name: '', sku: '', price: '', stock: '' }); setShowAddModal(true); }}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2"
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Product
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Products" 
          value={products.length} 
          icon={<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
          color="#3B82F6"
          subtext="Active SKUs"
        />
        <StatCard 
          title="Total Value" 
          value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalValue)} 
          icon={<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          color="#10B981"
          subtext="Inventory Asset Value"
        />
        <StatCard 
          title="Low Stock Alerts" 
          value={lowStockCount} 
          icon={<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
          color="#F59E0B"
          subtext="Items below minimum"
        />
        <StatCard 
          title="Out of Stock" 
          value={outOfStockCount} 
          icon={<svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>}
          color="#EF4444"
          subtext="Restock immediately"
        />
      </div>

      {/* Main Content */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Filters */}
        <div className="p-5 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setFilter('ALL')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${filter === 'ALL' ? 'bg-white text-blue-600 border-blue-200 shadow-sm' : 'bg-transparent text-gray-500 border-transparent hover:bg-gray-100'}`}
            >
              All Items
            </button>
            <button 
              onClick={() => setFilter('LOW_STOCK')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${filter === 'LOW_STOCK' ? 'bg-white text-yellow-600 border-yellow-200 shadow-sm' : 'bg-transparent text-gray-500 border-transparent hover:bg-gray-100'}`}
            >
              Low Stock
            </button>
            <button 
              onClick={() => setFilter('OUT_OF_STOCK')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${filter === 'OUT_OF_STOCK' ? 'bg-white text-red-600 border-red-200 shadow-sm' : 'bg-transparent text-gray-500 border-transparent hover:bg-gray-100'}`}
            >
              Out of Stock
            </button>
          </div>
          <div className="relative w-full md:w-64">
            <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input 
              type="text" 
              placeholder="Search by name or SKU..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-white"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product Name</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">SKU</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Price</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Stock</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.length > 0 ? (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{product.name}</div>
                      <div className="text-xs text-gray-400">Last updated: {new Date(product.lastUpdated).toLocaleDateString()}</div>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-500">{product.sku}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                        {product.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 text-right">
                      ${product.price.toFixed ? product.price.toFixed(2) : Number(product.price).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 text-right">
                      <span className={`font-medium ${product.stock < product.minStock ? 'text-red-600' : 'text-gray-900'}`}>
                        {product.stock}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={product.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="text-gray-400 hover:text-blue-600 transition-colors p-1">
                        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
                      <p className="text-base font-medium text-gray-900">No products found</p>
                      <p className="text-sm text-gray-400 mt-1">Try adjusting your search or filters</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/30 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            Showing <span className="font-medium">{filteredProducts.length}</span> of <span className="font-medium">{products.length}</span> products
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1 border border-gray-200 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50" disabled>Previous</button>
            <button className="px-3 py-1 border border-gray-200 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50" disabled>Next</button>
          </div>
        </div>
      </div>

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-4">Add New Product</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Product Name *</label>
                <input type="text" value={newProduct.name} onChange={e => setNewProduct(p => ({...p, name: e.target.value}))} placeholder="e.g. Wireless Headphones"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">SKU</label>
                <input type="text" value={newProduct.sku} onChange={e => setNewProduct(p => ({...p, sku: e.target.value}))} placeholder="e.g. WH-1001"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Price (USD) *</label>
                  <input type="number" value={newProduct.price} onChange={e => setNewProduct(p => ({...p, price: e.target.value}))} placeholder="0.00" step="0.01" min="0"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Stock *</label>
                  <input type="number" value={newProduct.stock} onChange={e => setNewProduct(p => ({...p, stock: e.target.value}))} placeholder="0" min="0"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
                Cancel
              </button>
              <button
                disabled={saving || !newProduct.name.trim()}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const priceMinor = Math.round(parseFloat(newProduct.price || '0') * 100);
                    await createProduct({
                      name: newProduct.name.trim(),
                      sku: newProduct.sku.trim(),
                      price_minor: priceMinor,
                      stock: parseInt(newProduct.stock || '0', 10)
                    });
                    setShowAddModal(false);
                    // Refresh product list
                    const res = await fetchProducts();
                    const mapped = res.map((p: Product) => ({
                      id: p.id, name: p.name, sku: p.sku || '', category: '',
                      price: (p.price_minor || 0) / 100, stock: p.stock || 0, minStock: 10,
                      status: statusForStock(p.stock || 0),
                      lastUpdated: p.updated_at || new Date().toISOString()
                    }));
                    setProducts(mapped);
                  } catch (e: unknown) {
                    console.error('Failed to create product', e);
                    alert('Failed to create product: ' + getErrorMessage(e, 'Unknown error'));
                  } finally {
                    setSaving(false);
                  }
                }}
                className={`flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors ${saving || !newProduct.name.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {saving ? 'Creating...' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
