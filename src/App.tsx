/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  History as HistoryIcon, 
  Settings, 
  Image as ImageIcon, 
  Wand2, 
  X, 
  Check, 
  Download, 
  Trash2,
  RefreshCw,
  Plus,
  Menu
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeProductImage, generateEcommerceImages, AnalysisResult, fetchSaasImages } from './services/aiService';

interface TextItem {
  id: string;
  text: string;
  position: string; // 'tl', 'tc', 'tr', 'rc', 'br', 'bc', 'bl', 'lc'
}

interface HistoryItem {
  id: string;
  sourceImage: string;
  generatedImages: string[]; // Store 3 images
  analysis: AnalysisResult;
  params: {
    style: string;
    aspectRatio: string;
    resolution: string;
  };
  textItems?: TextItem[];
  textColor?: string;
  timestamp: number;
  toolId?: string;
  userId?: string;
  projectType?: string;
  source?: string;
}

const PROJECT_TYPE = "beverage-ecommerce-image-generator";
const SOURCE = "beverage-ecommerce-result";

export default function App() {
  const [saasInfo, setSaasInfo] = useState<{ userId: string; toolId: string } | null>(null);
  const [step, setStep] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  // Params
  const [style, setStyle] = useState('现代简约');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [resolution, setResolution] = useState('1K');
  
  // Results
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  // Text Editor State
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [textColor, setTextColor] = useState('#FFFFFF');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mainFileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const toImageProxyUrl = (url: string) => {
    if (!url || url.startsWith('data:') || url.startsWith('/api/image-proxy')) return url;
    if (url.startsWith('http')) {
      return `/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  // Load history from local storage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SAAS_INIT') {
        const { userId, toolId } = event.data;
        setSaasInfo({ userId, toolId });
        console.log('SaaS Initialized:', { userId, toolId });
        // Trigger initial refresh
        fetchSaasImages(userId, toolId, SOURCE).then(saasImages => {
           const saasHistory: HistoryItem[] = saasImages.map((img: any) => ({
            id: img.id,
            sourceImage: img.url,
            generatedImages: [img.url],
            analysis: { productName: img.fileName || "远程图片", sellingPoints: [], suggestedColor: "#FFFFFF" },
            params: { style: '未知', aspectRatio: '1:1', resolution: '1K' },
            timestamp: new Date(img.createdAt).getTime(),
            toolId: img.toolId || toolId,
            userId: img.userId || userId,
            projectType: PROJECT_TYPE,
            source: SOURCE
          }));
          setHistory(prev => {
            const existingIds = new Set(prev.map(item => item.id));
            const newItems = saasHistory.filter(item => !existingIds.has(item.id));
            return [...newItems, ...prev]
              .filter(item => 
                 (!toolId || item.toolId === toolId) && 
                 item.projectType === PROJECT_TYPE
              )
              .sort((a, b) => b.timestamp - a.timestamp);
          });
        }).catch(console.error);
      }
    };
    window.addEventListener('message', handleMessage);
    
    // Also check URL parameters as a fallback (some SaaS patterns use this)
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const toolId = params.get('toolId');
    if (userId && toolId) {
      setSaasInfo({ userId, toolId });
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const historyKey = saasInfo?.toolId ? `beverage_image_history_${saasInfo.toolId}` : 'beverage_image_history_local';
    const savedHistory = localStorage.getItem(historyKey);
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        // Filter out legacy or incorrect tool items if necessary
        const filtered = parsed.filter((item: HistoryItem) => 
          (!saasInfo?.toolId || item.toolId === saasInfo.toolId) &&
          item.projectType === PROJECT_TYPE
        );
        setHistory(filtered);
      } catch (e) {
        console.error("Failed to load history", e);
      }
    } else {
      setHistory([]);
    }
  }, [saasInfo?.toolId]);

  // Save history
  useEffect(() => {
    const historyKey = saasInfo?.toolId ? `beverage_image_history_${saasInfo.toolId}` : 'beverage_image_history_local';
    if (history.length > 0) {
      localStorage.setItem(historyKey, JSON.stringify(history));
    }
  }, [history, saasInfo?.toolId]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setUploadedImage(base64);
        setStep(2);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setUploadedImage(event.target?.result as string);
        setStep(2);
      };
      reader.readAsDataURL(file);
    }
  };

  const refreshHistoryFromSaas = async () => {
    if (!saasInfo?.userId) return;
    try {
      const saasImages = await fetchSaasImages(saasInfo.userId, saasInfo.toolId, SOURCE);
      // Map SaaS images to a format history can display (partial)
      // Since we don't have analysis/source, we'll mark them as remote
      const saasHistory: HistoryItem[] = saasImages.map((img: any) => ({
        id: img.id,
        sourceImage: img.url, // Fallback
        generatedImages: [img.url],
        analysis: { productName: img.fileName || "远程图片", sellingPoints: [], suggestedColor: "#FFFFFF" },
        params: { style: '未知', aspectRatio: '1:1', resolution: '1K' },
        timestamp: new Date(img.createdAt).getTime(),
        toolId: saasInfo.toolId,
        userId: saasInfo.userId,
        projectType: PROJECT_TYPE,
        source: SOURCE
      }));

      // Merge with local history, avoiding duplicates by checking URL or ID
      setHistory(prev => {
        const existingIds = new Set(prev.map(item => item.id));
        const newItems = saasHistory.filter(item => !existingIds.has(item.id));
        return [...newItems, ...prev]
          .filter(item => 
            (!saasInfo.toolId || item.toolId === saasInfo.toolId) &&
            item.projectType === PROJECT_TYPE
          )
          .sort((a, b) => b.timestamp - a.timestamp);
      });
    } catch (e) {
      console.error("Failed to refresh from SaaS", e);
    }
  };

  const handleGenerate = async () => {
    if (!uploadedImage) return;
    
    setGenerating(true);
    setAnalyzing(true);
    setGeneratedImages([]);
    setStep(3);

    try {
      // Analyze once
      const analysisResult = await analyzeProductImage(uploadedImage, saasInfo?.userId, saasInfo?.toolId);
      setAnalysis(analysisResult);
      
      const initialTextItems: TextItem[] = [];
      
      // 1. Title
      initialTextItems.push({
        id: 'title',
        text: analysisResult.productName,
        position: 'tc'
      });

      // 2. Selling Points
      (analysisResult.sellingPoints || []).forEach((sp, i) => {
        if (i < 3) {
          initialTextItems.push({
            id: `sp-${i}`,
            text: sp.text,
            position: sp.position
          });
        }
      });

      // 3. Optional Footer
      initialTextItems.push({
        id: 'footer',
        text: "补充信息：点击下方修改",
        position: 'bc'
      });

      setTextItems(initialTextItems);
      setTextColor(analysisResult.suggestedColor);

      // Generate 3 images
      const initialImages: string[] = [];
      const ecomImages = await generateEcommerceImages(
        uploadedImage, 
        style, 
        aspectRatio, 
        resolution, 
        saasInfo?.userId, 
        saasInfo?.toolId,
        (url, index) => {
          setGeneratedImages(prev => {
            const next = [...prev];
            next[index] = url;
            return next;
          });
          if (index === 0) setSelectedImageIndex(0);
        }
      );

      const newItem: HistoryItem = {
        id: Date.now().toString(),
        sourceImage: uploadedImage,
        generatedImages: ecomImages,
        analysis: analysisResult,
        params: { style, aspectRatio, resolution },
        textItems: initialTextItems,
        textColor: analysisResult.suggestedColor,
        timestamp: Date.now(),
        toolId: saasInfo?.toolId,
        userId: saasInfo?.userId,
        projectType: PROJECT_TYPE,
        source: SOURCE
      };
      setHistory(prev => [newItem, ...prev]);
      
    } catch (error: any) {
      console.error("Generation failed", error);
      alert(`生成失败: ${error.message}`);
      // Refresh history if it's a timeout error
      if (error.message.includes("Timeout") || error.message.includes("Gateway")) {
        refreshHistoryFromSaas();
      }
    } finally {
      setGenerating(false);
      setAnalyzing(false);
    }
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || generatedImages.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = toImageProxyUrl(generatedImages[selectedImageIndex]);
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const padding = img.width * 0.05; // Closer to edges
      const centerGap = img.width * 0.25; // Increase gap from center to avoid product
      const baseFontSize = img.height / 800;
      
      const titleSize = 28 * baseFontSize;
      const detailSize = 20 * baseFontSize;
      const footerSize = 18 * baseFontSize;

      // 1. Draw Title (Header) - Index 0
      if (textItems.length > 0) {
        ctx.font = `bold ${titleSize}px sans-serif`;
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.fillText(textItems[0].text, img.width / 2, padding + titleSize);
      }

      // 2. Draw Selling Points (Detail)
      const details = textItems.slice(1, textItems.length > 4 ? 4 : textItems.length);
      const detailCount = details.length;

      ctx.fillStyle = textColor;
      const drawBullet = (x: number, y: number, align: CanvasTextAlign) => {
        const radius = 4 * baseFontSize;
        const iconGap = 12 * baseFontSize;
        ctx.beginPath();
        const iconX = align === 'right' ? x + iconGap : x - iconGap;
        ctx.arc(iconX, y - detailSize / 3, radius, 0, Math.PI * 2);
        ctx.fill();
      };

      if (detailCount === 1) {
        // 1 point: Left center
        ctx.font = `600 ${detailSize}px sans-serif`;
        ctx.textAlign = 'left';
        const x = padding + 15 * baseFontSize;
        const y = img.height / 2;
        ctx.fillText(details[0].text, x, y);
        drawBullet(x, y, 'left');
      } else if (detailCount === 2) {
        // 2 points: Left & Right
        ctx.font = `600 ${detailSize}px sans-serif`;
        // Left
        const lx = img.width / 2 - centerGap;
        const ly = img.height / 2;
        ctx.textAlign = 'right';
        ctx.fillText(details[0].text, lx, ly);
        drawBullet(lx, ly, 'right');
        // Right
        const rx = img.width / 2 + centerGap;
        const ry = img.height / 2;
        ctx.textAlign = 'left';
        ctx.fillText(details[1].text, rx, ry);
        drawBullet(rx, ry, 'left');
      } else if (detailCount === 3) {
        // 3 points: 1 Left, 2 Right (upper/lower)
        ctx.font = `600 ${detailSize}px sans-serif`;
        // Left (0)
        const lx = img.width / 2 - centerGap;
        const ly = img.height / 2;
        ctx.textAlign = 'right';
        ctx.fillText(details[0].text, lx, ly);
        drawBullet(lx, ly, 'right');
        // Right Top (1)
        const rtx = img.width / 2 + centerGap;
        const rty = img.height / 2 - detailSize * 1.5;
        ctx.textAlign = 'left';
        ctx.fillText(details[1].text, rtx, rty);
        drawBullet(rtx, rty, 'left');
        // Right Bottom (2)
        const rbx = img.width / 2 + centerGap;
        const rby = img.height / 2 + detailSize * 1.5;
        ctx.textAlign = 'left';
        ctx.fillText(details[2].text, rbx, rby);
        drawBullet(rbx, rby, 'left');
      }

      // 3. Draw Footer
      if (textItems.length >= 5) {
        const footerItem = textItems[textItems.length - 1];
        ctx.font = `${footerSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(footerItem.text, img.width / 2, img.height - padding);
      }
    };
  };

  useEffect(() => {
    if (generatedImages.length > 0) {
      drawCanvas();
    }
  }, [generatedImages, selectedImageIndex, textItems, textColor]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `beverage-ecommerce-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const removeFromHistory = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const loadFromHistory = (item: HistoryItem) => {
    setUploadedImage(item.sourceImage);
    setGeneratedImages(item.generatedImages);
    setSelectedImageIndex(0);
    setAnalysis(item.analysis);
    setTextItems(item.textItems || (item.analysis.sellingPoints || []).map(sp => ({ 
      id: Math.random().toString(), 
      text: typeof sp === 'string' ? sp : (sp as any).text, 
      position: typeof sp === 'string' ? 'tr' : (sp as any).position 
    })));
    setTextColor(item.textColor || item.analysis.suggestedColor);
    setStyle(item.params.style);
    setAspectRatio(item.params.aspectRatio);
    setResolution(item.params.resolution);
    setStep(3);
  };

  return (
    <div className="flex h-screen bg-[#F0F2F5] text-[#1D1D1F] font-sans overflow-hidden relative">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-[#E5E5E5] flex items-center justify-between px-4 z-50">
        <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
          <span className="bg-[#FF6B00] text-white p-1 rounded-lg">
            <ImageIcon size={18} />
          </span>
          AI 饮品电商
        </h1>
        <button 
          onClick={() => setSidebarOpen(true)}
          className="p-2 hover:bg-[#F5F5F7] rounded-full transition-colors"
        >
          <Menu size={24} />
        </button>
      </div>

      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed lg:relative inset-y-0 left-0 w-80 flex flex-col border-r border-[#E5E5E5] bg-white z-[70] transition-transform duration-300 transform
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6 border-b border-[#E5E5E5] flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <span className="bg-[#FF6B00] text-white p-1 rounded-lg">
              <ImageIcon size={20} />
            </span>
            AI 饮品电商
          </h1>
          <button 
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-2 hover:bg-[#F5F5F7] rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Step 1: Upload */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-6 h-6 rounded-full bg-[#1D1D1F] text-white flex items-center justify-center text-xs font-bold">1</span>
              <h2 className="font-semibold">产品上传与分析</h2>
            </div>
            
            <div 
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-2xl aspect-square flex flex-col items-center justify-center cursor-pointer transition-all ${uploadedImage ? 'border-[#FF6B00] bg-[#FFF8F2]' : 'border-[#D2D2D7] hover:border-[#FF6B00]'}`}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*" 
                onChange={handleFileUpload} 
              />
              {uploadedImage ? (
                <img src={toImageProxyUrl(uploadedImage)} alt="Preview" className="w-full h-full object-contain p-2 rounded-2xl" />
              ) : (
                <div className="text-center p-4">
                  <Upload className="mx-auto mb-2 text-[#86868B]" />
                  <p className="text-sm font-medium">点击或拖拽上传</p>
                  <p className="text-xs text-[#86868B] mt-1">支持 PNG, JPG</p>
                </div>
              )}
            </div>
          </section>

          {/* History */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <HistoryIcon size={18} className="text-[#86868B]" />
                <h2 className="font-semibold">历史记录</h2>
              </div>
              <button 
                onClick={refreshHistoryFromSaas}
                className="p-1.5 hover:bg-[#F5F5F7] rounded-lg transition-colors text-[#86868B] hover:text-[#FF6B00]"
                title="从云端刷新"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            
            {history.length === 0 ? (
              <div className="text-center py-12 text-[#86868B]">
                <RefreshCw size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-xs">暂无历史记录</p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map(item => (
                  <div key={item.id} className="group relative bg-[#F5F5F7] rounded-xl p-2 cursor-pointer hover:bg-[#E8E8ED] transition-colors overflow-hidden flex gap-3 min-h-[64px]">
                    <div className="relative flex-shrink-0">
                      <img 
                        src={toImageProxyUrl(item.generatedImages[0])} 
                        className="w-12 h-12 object-cover rounded-lg bg-white border border-[#E5E5E5]" 
                        onClick={() => loadFromHistory(item)}
                      />
                      <div className="absolute -top-1 -right-1 bg-[#FF6B00] text-white text-[8px] px-1 rounded-full font-bold shadow-sm border border-white">
                        {item.generatedImages.length}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center" onClick={() => loadFromHistory(item)}>
                      <p className="text-[11px] font-bold text-[#1D1D1F] truncate group-hover:text-[#FF6B00] transition-colors">{item.analysis.productName}</p>
                      <p className="text-[10px] text-[#86868B]">{new Date(item.timestamp).toLocaleDateString()}</p>
                    </div>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setHistory(prev => prev.filter(h => h.id !== item.id));
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 hover:text-red-500 transition-all flex items-center"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative pt-20 lg:pt-8">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.section 
              key="step1"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-4xl mx-auto space-y-8"
            >
              <div className="text-center space-y-4 mb-12">
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">打造震撼视角的<span className="text-[#FF6B00]">饮品电商大片</span></h2>
                <p className="text-[#86868B] text-lg max-w-2xl mx-auto">只需上传您的产品图片，我们的 AI 将自动分析卖点并生成多种风格的专业电商主图。</p>
              </div>

              <div className="flex items-center gap-2 mb-6">
                <span className="w-6 h-6 rounded-full bg-[#FF6B00] text-white flex items-center justify-center text-xs font-bold">1</span>
                <h2 className="text-lg font-bold">上传产品原图</h2>
              </div>

              <div 
                onClick={() => mainFileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`
                  relative border-3 border-dashed rounded-[40px] aspect-video sm:aspect-[21/9] flex flex-col items-center justify-center cursor-pointer transition-all duration-500
                  ${uploadedImage 
                    ? 'border-[#FF6B00] bg-white shadow-2xl shadow-[#FF6B00]/10' 
                    : 'border-[#D2D2D7] bg-white hover:border-[#FF6B00] hover:bg-[#FFF8F2] shadow-sm'}
                `}
              >
                <input 
                  type="file" 
                  ref={mainFileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleFileUpload} 
                />
                
                {uploadedImage ? (
                  <div className="relative w-full h-full p-8 flex items-center justify-center">
                    <img 
                      src={toImageProxyUrl(uploadedImage)} 
                      alt="Preview" 
                      className="max-w-full max-h-full object-contain rounded-2xl shadow-lg" 
                    />
                    <div className="absolute top-4 right-4 flex gap-2">
                      <button 
                         onClick={(e) => { e.stopPropagation(); setUploadedImage(null); }}
                         className="p-3 bg-white/90 backdrop-blur rounded-full shadow-lg text-red-500 hover:bg-white transition-colors"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center p-8 space-y-4">
                    <div className="w-20 h-20 bg-[#F5F5F7] rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                      <Upload className="text-[#86868B]" size={32} />
                    </div>
                    <div>
                      <p className="text-xl font-bold">点击或将图片拖拽至此</p>
                      <p className="text-[#86868B] mt-2">建议背景干净，产品位于中心（PNG/JPG/WEBP）</p>
                    </div>
                  </div>
                )}
              </div>

              {uploadedImage && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-center"
                >
                  <button 
                    onClick={() => setStep(2)}
                    className="px-12 py-5 bg-[#FF6B00] text-white rounded-full font-bold text-lg shadow-xl shadow-[#FF6B00]/30 hover:bg-[#E66000] hover:scale-105 active:scale-95 transition-all flex items-center gap-3"
                  >
                    准备好了，去设置参数 <Check size={20} />
                  </button>
                </motion.div>
              )}
            </motion.section>
          )}

          {step === 2 && (
            <motion.section 
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-4xl mx-auto space-y-8"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#FF6B00] text-white flex items-center justify-center text-xs font-bold">2</span>
                  <h2 className="text-lg font-bold">参数设置</h2>
                </div>
                <button 
                  onClick={() => setStep(1)}
                  className="text-sm text-[#86868B] hover:text-[#1D1D1F] flex items-center gap-1"
                >
                  <X size={14} /> 重新上传
                </button>
              </div>
              
              <div className="bg-[#F5F5F7] rounded-3xl p-4 sm:p-8 space-y-8 border border-[#E5E5E5]">
                {/* Style Selection */}
                <div>
                  <h3 className="text-sm font-semibold text-[#86868B] uppercase tracking-wider mb-4">整体视觉风格</h3>
                  <div className="flex flex-wrap gap-2 sm:gap-3">
                    {['现代简约', '奢华高级', '模特氛围'].map(s => (
                      <button
                        key={s}
                        onClick={() => setStyle(s)}
                        className={`flex-1 sm:flex-none px-4 sm:px-6 py-2.5 sm:py-3 rounded-full text-xs sm:text-sm font-medium transition-all ${style === s ? 'bg-[#FF6B00] text-white shadow-lg shadow-[#FF6B00]/20' : 'bg-white border border-[#D2D2D7] hover:border-[#FF6B00]'}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Canvas Ratio and Resolution */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                  <div>
                    <h3 className="text-sm font-semibold text-[#86868B] uppercase tracking-wider mb-4">画布比例</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {['1:1', '3:4', '4:3', '16:9'].map(r => (
                        <button
                          key={r}
                          onClick={() => setAspectRatio(r)}
                          className={`p-2.5 sm:p-3 rounded-xl text-center text-[10px] sm:text-xs font-bold border transition-all ${aspectRatio === r ? 'border-[#FF6B00] bg-white text-[#FF6B00]' : 'border-[#D2D2D7] bg-transparent text-[#1D1D1F] hover:border-[#FF6B00]'}`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#86868B] uppercase tracking-wider mb-4">输出分辨率</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {['1K', '2K', '4K'].map(res => (
                        <button
                          key={res}
                          onClick={() => setResolution(res)}
                          className={`p-2.5 sm:p-3 rounded-xl text-center text-[10px] sm:text-xs font-bold border transition-all ${resolution === res ? 'border-[#FF6B00] bg-white text-[#FF6B00]' : 'border-[#D2D2D7] bg-transparent text-[#1D1D1F] hover:border-[#FF6B00]'}`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button 
                  onClick={handleGenerate}
                  disabled={!uploadedImage || generating}
                  className="w-full py-5 bg-[#1D1D1F] text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-[#2c2c2e] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  {generating ? (
                    <RefreshCw className="animate-spin" />
                  ) : (
                    <Wand2 className="group-hover:rotate-12 transition-transform" />
                  )}
                  {generating ? 'AI 正在打造视觉大片...' : '立即开始生成主图'}
                </button>
              </div>
            </motion.section>
          )}

          {step === 3 && (
            <motion.section 
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="max-w-6xl mx-auto space-y-8"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#FF6B00] text-white flex items-center justify-center text-xs font-bold">3</span>
                  <h2 className="text-lg font-bold">生成结果与精修</h2>
                </div>
                
                <button 
                  onClick={() => setStep(2)}
                  className="text-sm text-[#86868B] hover:text-[#1D1D1F] flex items-center gap-1"
                >
                  <X size={14} /> 返回设置
                </button>
              </div>

              {generating && generatedImages.length === 0 ? (
                <div className="bg-[#F5F5F7] rounded-3xl min-h-[600px] flex flex-col items-center justify-center space-y-6 border border-[#E5E5E5] border-dashed">
                  <div className="relative">
                     <RefreshCw className="text-[#FF6B00] animate-spin w-16 h-16 opacity-30" />
                     <div className="absolute inset-0 flex items-center justify-center">
                        <Wand2 className="text-[#FF6B00] animate-pulse" size={32} />
                     </div>
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-xl font-bold">AI 绘图中...</h3>
                    <p className="text-[#86868B] max-w-xs">正在根据您的要求生成不同视角的电商大片，请稍后</p>
                  </div>
                  <div className="flex gap-2">
                    {[0, 1, 2].map(i => (
                      <motion.div 
                        key={i}
                        animate={{ y: [0, -10, 0] }}
                        transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                        className="w-2 h-2 rounded-full bg-[#FF6B00]"
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-8">
                  {/* Left Column: Canvas & Images */}
                  <div className="space-y-6">
                    <div className="bg-[#F5F5F7] rounded-3xl p-4 sm:p-6 flex flex-col items-center justify-center min-h-[300px] sm:min-h-[500px] border border-[#E5E5E5] relative overflow-hidden group">
                      <canvas 
                        ref={canvasRef} 
                        className="max-w-full max-h-[70vh] sm:max-h-full rounded-xl shadow-2xl bg-white transition-transform group-hover:scale-[1.01]"
                      />
                      
                      {generating && (
                        <div className="absolute bottom-4 sm:bottom-6 right-4 sm:right-6 bg-white/90 backdrop-blur px-3 sm:px-4 py-1.5 sm:py-2 rounded-full shadow-lg flex items-center gap-2 sm:gap-3 border border-[#E5E5E5]">
                           <RefreshCw size={14} className="text-[#FF6B00] animate-spin" />
                           <span className="text-[10px] sm:text-xs font-bold">生成中...</span>
                        </div>
                      )}

                      <div className="absolute top-4 left-4 bg-white/80 backdrop-blur text-xs px-3 py-1 rounded-full border border-black/5 flex items-center gap-2">
                        {generatedImages.length > 0 && <Check size={12} className="text-green-500" />} 
                        {["正面", "俯拍", "特写"][selectedImageIndex]}视角
                      </div>
                    </div>

                    {/* Thumbnails & Perspective Switcher */}
                    <div className="bg-white border border-[#E5E5E5] p-3 sm:p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex gap-2 sm:gap-3 overflow-x-auto w-full sm:w-auto pb-2 sm:pb-0">
                        {[0, 1, 2].map(idx => (
                          <button
                            key={idx}
                            onClick={() => setSelectedImageIndex(idx)}
                            disabled={!generatedImages[idx]}
                            className={`relative flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border-2 transition-all ${selectedImageIndex === idx ? 'border-[#FF6B00] scale-105 shadow-md' : 'border-transparent opacity-60 hover:opacity-100'} disabled:opacity-20`}
                          >
                            {generatedImages[idx] ? (
                              <img src={toImageProxyUrl(generatedImages[idx])} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-[#F5F5F7] flex items-center justify-center">
                                <RefreshCw className="animate-spin text-[#86868B]" size={14} />
                              </div>
                            )}
                          </button>
                        ))}
                      </div>

                      <div className="flex gap-1 p-1 bg-[#F5F5F7] rounded-xl border border-[#E5E5E5] w-full sm:w-auto overflow-x-auto">
                        {["正面视角", "俯拍视角", "特写视角"].map((label, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedImageIndex(idx)}
                            disabled={!generatedImages[idx]}
                            className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all whitespace-nowrap ${selectedImageIndex === idx ? 'bg-white text-[#FF6B00] shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F]'} disabled:opacity-50`}
                          >
                            {label.replace('视角', '')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Controls */}
                  <div className="space-y-6">
                    {/* Params (Step 2 Functions in Step 3) */}
                    <div className="bg-white border border-[#E5E5E5] rounded-3xl p-6 space-y-4 shadow-sm">
                      <h3 className="text-sm font-bold flex items-center gap-2">
                        <Settings size={16} className="text-[#FF6B00]" /> 参数调整
                      </h3>
                      
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">风格</label>
                          <select 
                            value={style} 
                            onChange={(e) => setStyle(e.target.value)}
                            className="w-full mt-1 bg-[#F5F5F7] border border-[#E5E5E5] rounded-xl p-2 text-sm focus:ring-2 focus:ring-[#FF6B00] outline-none"
                          >
                            {['现代简约', '奢华高级', '模特氛围'].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">比例</label>
                            <select 
                              value={aspectRatio} 
                              onChange={(e) => setAspectRatio(e.target.value)}
                              className="w-full mt-1 bg-[#F5F5F7] border border-[#E5E5E5] rounded-xl p-2 text-sm focus:ring-2 focus:ring-[#FF6B00] outline-none"
                            >
                              {['1:1', '3:4', '4:3', '16:9'].map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">分辨率</label>
                            <select 
                              value={resolution} 
                              onChange={(e) => setResolution(e.target.value)}
                              className="w-full mt-1 bg-[#F5F5F7] border border-[#E5E5E5] rounded-xl p-2 text-sm focus:ring-2 focus:ring-[#FF6B00] outline-none"
                            >
                              {['1K', '2K', '4K'].map(res => <option key={res} value={res}>{res}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>

                      <button 
                        onClick={handleGenerate}
                        disabled={generating}
                        className="w-full py-3 bg-[#1D1D1F] text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-black transition-all disabled:opacity-50"
                      >
                        {generating ? <RefreshCw className="animate-spin" size={14} /> : <Wand2 size={14} />}
                        重新生成
                      </button>
                    </div>

                    {/* Text Editor */}
                    <div className="bg-white border border-[#E5E5E5] rounded-3xl p-6 space-y-6 shadow-sm">
                      <div>
                        <h3 className="text-sm font-bold mb-4">文案精修</h3>
                        <div className="space-y-4">
                          {textItems.map((item, i) => {
                            let label = i === 0 ? "主标题" : i === textItems.length - 1 ? "底部信息" : `卖点 ${i}`;
                            return (
                              <div key={item.id} className="space-y-1">
                                <label className="text-[10px] font-bold text-[#86868B] uppercase px-1">{label}</label>
                                <div className="flex gap-2">
                                  <input 
                                    value={item.text} 
                                    onChange={(e) => {
                                      const newItems = [...textItems];
                                      newItems[i].text = e.target.value;
                                      setTextItems(newItems);
                                    }}
                                    className="flex-1 bg-[#F5F5F7] border border-[#E5E5E5] rounded-xl p-2 text-sm focus:ring-2 focus:ring-[#FF6B00] outline-none"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-[10px] font-bold text-[#86868B] mb-2 uppercase">配色建议</h4>
                        <div className="flex flex-wrap gap-2">
                          {['#FFFFFF', '#000000', analysis?.suggestedColor || '#FF6B00'].map(c => (
                            <button 
                              key={c}
                              onClick={() => setTextColor(c)}
                              style={{ backgroundColor: c }}
                              className={`w-6 h-6 rounded-full border-2 transition-all ${textColor === c ? 'border-[#FF6B00] scale-110' : 'border-[#E5E5E5]'}`}
                            />
                          ))}
                          <input 
                            type="color" 
                            value={textColor} 
                            onChange={(e) => setTextColor(e.target.value)}
                            className="w-6 h-6 rounded-full border-none p-0 overflow-hidden cursor-pointer"
                          />
                        </div>
                      </div>

                      <button 
                        onClick={handleDownload}
                        className="w-full py-4 bg-[#FF6B00] text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-[#E66000] active:scale-[0.98] transition-all shadow-lg shadow-[#FF6B00]/30"
                      >
                        <Download size={18} /> 下载发布图
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
