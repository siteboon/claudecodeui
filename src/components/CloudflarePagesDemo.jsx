import React from 'react';
import { config } from '../config/api.js';

const CloudflarePagesDemo = () => {
  if (!config.isCloudflarePages || !config.isProduction) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-8 max-w-2xl mx-4 text-center">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            🎉 Claude Code UI Demo
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            مرحباً بك في النسخة التجريبية من Claude Code UI على Cloudflare Pages!
          </p>
        </div>
        
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-blue-900 dark:text-blue-100 mb-3">
            ℹ️ معلومات مهمة
          </h2>
          <ul className="text-left text-blue-800 dark:text-blue-200 space-y-2">
            <li>• هذا نسخة تجريبية تعمل على Cloudflare Pages</li>
            <li>• الوظائف الكاملة تتطلب خادم backend منفصل</li>
            <li>• يمكنك تصفح الواجهة والتصميم</li>
            <li>• API calls تعرض بيانات تجريبية</li>
          </ul>
        </div>
        
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-green-900 dark:text-green-100 mb-3">
            🚀 الميزات المتاحة
          </h2>
          <ul className="text-left text-green-800 dark:text-green-200 space-y-2">
            <li>• واجهة مستخدم كاملة ومتجاوبة</li>
            <li>• تصميم جميل مع دعم الوضع المظلم</li>
            <li>• دعم الأجهزة المحمولة</li>
            <li>• PWA (Progressive Web App)</li>
            <li>• SEO محسن</li>
          </ul>
        </div>
        
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-yellow-900 dark:text-yellow-100 mb-3">
            ⚠️ الميزات غير المتاحة
          </h2>
          <ul className="text-left text-yellow-800 dark:text-yellow-200 space-y-2">
            <li>• Chat مع Claude AI</li>
            <li>• إدارة المشاريع الحقيقية</li>
            <li>• WebSocket connections</li>
            <li>• File operations</li>
            <li>• Git operations</li>
          </ul>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            🔄 تحديث الصفحة
          </button>
          <a
            href="https://github.com/you112ef/claudecodeui"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            📚 عرض الكود
          </a>
        </div>
        
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-6">
          هذا الموقع يعمل على Cloudflare Pages - خدمة استضافة ثابتة مجانية
        </p>
      </div>
    </div>
  );
};

export default CloudflarePagesDemo;