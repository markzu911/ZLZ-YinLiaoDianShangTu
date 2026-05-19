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
  Plus
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
}

export default function App() {
  const [saasInfo, setSaasInfo] = useState<{ userId: string; toolId: string } | null>(null);
  const [step, setStep] = useState(2);
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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load history from local storage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SAAS_INIT') {
        const { userId, toolId } = event.data;
        setSaasInfo({ userId, toolId });
        console.log('SaaS Initialized:', { userId, toolId });
        // Trigger initial refresh
        fetchSaasImages(userId).then(saasImages => {
           const saasHistory: HistoryItem[] = saasImages.map((img: any) => ({
            id: img.id,
            sourceImage: img.url,
            generatedImages: [img.url],
            analysis: { productName: img.fileName || "远程图片", sellingPoints: [], suggestedColor: "#FFFFFF" },
            params: { style: '未知', aspectRatio: '1:1', resolution: '1K' },
            timestamp: new Date(img.createdAt).getTime()
          }));
          setHistory(prev => {
            const existingIds = new Set(prev.map(item => item.id));
            const newItems = saasHistory.filter(item => !existingIds.has(item.id));
            return [...newItems, ...prev].sort((a, b) => b.timestamp - a.timestamp);
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
    const savedHistory = localStorage.getItem('beverage_image_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  // Save history
  useEffect(() => {
    localStorage.setItem('beverage_image_history', JSON.stringify(history));
  }, [history]);

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
      const saasImages = await fetchSaasImages(saasInfo.userId);
      // Map SaaS images to a format history can display (partial)
      // Since we don't have analysis/source, we'll mark them as remote
      const saasHistory: HistoryItem[] = saasImages.map((img: any) => ({
        id: img.id,
        sourceImage: img.url, // Fallback
        generatedImages: [img.url],
        analysis: { productName: img.fileName || "远程图片", sellingPoints: [], suggestedColor: "#FFFFFF" },
        params: { style: '未知', aspectRatio: '1:1', resolution: '1K' },
        timestamp: new Date(img.createdAt).getTime()
      }));

      // Merge with local history, avoiding duplicates by checking URL or ID
      setHistory(prev => {
        const existingIds = new Set(prev.map(item => item.id));
        const newItems = saasHistory.filter(item => !existingIds.has(item.id));
        return [...newItems, ...prev].sort((a, b) => b.timestamp - a.timestamp);
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
        timestamp: Date.now()
      };
      setHistory(prev => [newItem, ...prev]);
      
      setStep(3);
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
    img.src = generatedImages[selectedImageIndex];
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
    <div className="flex h-screen bg-[#F0F2F5] text-[#1D1D1F] font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 flex flex-col border-r border-[#E5E5E5] bg-white">
        <div className="p-6 border-bottom border-[#E5E5E5]">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <span className="bg-[#FF6B00] text-white p-1 rounded-lg">
              <ImageIcon size={20} />
            </span>
            AI 饮品电商
          </h1>
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
                <img src={uploadedImage} alt="Preview" className="w-full h-full object-contain p-2 rounded-2xl" />
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
                  <div key={item.id} className="group relative bg-[#F5F5F7] rounded-xl p-2 cursor-pointer hover:bg-[#E8E8ED] transition-colors overflow-hidden flex gap-3">
                    <div className="relative">
                      <img 
                        src={item.generatedImages[0]} 
                        className="w-16 h-16 object-cover rounded-lg bg-white" 
                        onClick={() => loadFromHistory(item)}
                      />
                      <div className="absolute -top-1 -right-1 bg-[#FF6B00] text-white text-[8px] px-1 rounded-full font-bold">
                        3
                      </div>
                    </div>
                    <div className="flex-1" onClick={() => loadFromHistory(item)}>
                      <p className="text-xs font-semibold truncate">{item.analysis.productName}</p>
                      <p className="text-[10px] text-[#86868B]">{new Date(item.timestamp).toLocaleDateString()}</p>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeFromHistory(item.id); }}
                      className="absolute top-1 right-1 p-1 bg-white/80 rounded-full opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity translate-x-2 group-hover:translate-x-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8 relative space-y-12">
        {/* Section 2: Params */}
        <section className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-6">
            <span className="w-6 h-6 rounded-full bg-[#FF6B00] text-white flex items-center justify-center text-xs font-bold">2</span>
            <h2 className="text-lg font-bold">参数设置</h2>
          </div>
          
          <div className="bg-[#F5F5F7] rounded-3xl p-8 space-y-8 border border-[#E5E5E5]">
            {/* Style Selection */}
            <div>
              <h3 className="text-sm font-semibold text-[#86868B] uppercase tracking-wider mb-4">整体视觉风格</h3>
              <div className="flex flex-wrap gap-3">
                {['现代简约', '奢华高级', '模特氛围'].map(s => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className={`px-6 py-3 rounded-full text-sm font-medium transition-all ${style === s ? 'bg-[#FF6B00] text-white shadow-lg shadow-[#FF6B00]/20' : 'bg-white border border-[#D2D2D7] hover:border-[#FF6B00]'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Canvas Ratio and Resolution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-sm font-semibold text-[#86868B] uppercase tracking-wider mb-4">画布比例</h3>
                <div className="grid grid-cols-4 gap-2">
                  {['1:1', '3:4', '4:3', '16:9'].map(r => (
                    <button
                      key={r}
                      onClick={() => setAspectRatio(r)}
                      className={`p-3 rounded-xl text-center text-xs font-bold border transition-all ${aspectRatio === r ? 'border-[#FF6B00] bg-white text-[#FF6B00]' : 'border-[#D2D2D7] bg-transparent text-[#1D1D1F] hover:border-[#FF6B00]'}`}
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
                      className={`p-3 rounded-xl text-center text-xs font-bold border transition-all ${resolution === res ? 'border-[#FF6B00] bg-white text-[#FF6B00]' : 'border-[#D2D2D7] bg-transparent text-[#1D1D1F] hover:border-[#FF6B00]'}`}
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

          {generating && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-4 py-8"
            >
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <motion.div 
                    key={i}
                    animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                    className="w-2 h-2 rounded-full bg-[#FF6B00]"
                  />
                ))}
              </div>
              <p className="text-sm text-[#86868B] italic">
                分析产品卖点中... 选取最佳构图... 背景渲染中...
              </p>
            </motion.div>
          )}
        </section>

        {/* Section 3: Results */}
        <AnimatePresence>
          {generatedImages.length > 0 && (
            <motion.section 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-6xl mx-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#FF6B00] text-white flex items-center justify-center text-xs font-bold">3</span>
                  <h2 className="text-lg font-bold">生成结果与精修</h2>
                </div>
                
                {/* Viewport Switcher */}
                <div className="flex gap-2 bg-[#F5F5F7] p-1 rounded-xl border border-[#E5E5E5]">
                  {["正面", "俯拍", "特写"].map((label, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedImageIndex(idx)}
                      className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${selectedImageIndex === idx ? 'bg-white text-[#FF6B00] shadow-sm' : 'text-[#86868B] hover:text-[#1D1D1F]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-8">
                {/* Result Preview */}
                <div className="space-y-4">
                  <div className="bg-[#F5F5F7] rounded-3xl p-6 flex flex-col items-center justify-center min-h-[500px] border border-[#E5E5E5] relative overflow-hidden">
                    <canvas 
                      ref={canvasRef} 
                      className="max-w-full max-h-full rounded-xl shadow-2xl bg-white"
                    />
                    <div className="absolute top-4 left-4 bg-white/80 backdrop-blur text-xs px-3 py-1 rounded-full border border-black/5 flex items-center gap-2">
                       <Check size={12} className="text-green-500" /> {["正面", "俯拍", "特写"][selectedImageIndex]}视角 渲染完成
                    </div>
                  </div>
                  
                  {/* Thumbnail Row */}
                  <div className="flex gap-4 justify-center">
                    {generatedImages.map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedImageIndex(idx)}
                        className={`w-20 h-20 rounded-xl overflow-hidden border-2 transition-all ${selectedImageIndex === idx ? 'border-[#FF6B00] scale-105 shadow-md' : 'border-transparent opacity-60 hover:opacity-100'}`}
                      >
                        <img src={img} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Edit Controls */}
                <div className="space-y-6">
                  <div className="bg-white border border-[#E5E5E5] rounded-3xl p-6 space-y-6 shadow-sm">
                    <div>
                      <h3 className="text-sm font-semibold mb-4">文本内容编辑</h3>
                      <div className="space-y-4">
                        {textItems.map((item, i) => {
                          let label = "文案";
                          if (i === 0) label = "主标题";
                          else if (i === textItems.length - 1) label = "底部补充";
                          else label = `卖点 ${i}`;

                          return (
                            <div key={item.id} className="space-y-1">
                              <label className="text-[10px] font-bold text-[#86868B] uppercase px-1">{label}</label>
                              <div className="flex gap-2 p-2 bg-[#F5F5F7] rounded-2xl border border-[#E5E5E5]">
                                <input 
                                  value={item.text} 
                                  onChange={(e) => {
                                    const newItems = [...textItems];
                                    newItems[i].text = e.target.value;
                                    setTextItems(newItems);
                                  }}
                                  className="flex-1 bg-white border border-[#D2D2D7] rounded-xl p-2 text-sm focus:ring-2 focus:ring-[#FF6B00] outline-none transition-all"
                                />
                                <button 
                                  onClick={() => setTextItems(prev => prev.filter(t => t.id !== item.id))}
                                  className="p-2 text-[#86868B] hover:text-red-500 bg-white border border-[#D2D2D7] rounded-xl"
                                >
                                   <X size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        <button 
                          onClick={() => setTextItems(prev => [...prev, { id: Math.random().toString(), text: "新卖点", position: 'tc' }])}
                          className="w-full py-3 border-2 border-dashed border-[#D2D2D7] rounded-xl text-xs font-semibold text-[#86868B] hover:border-[#FF6B00] hover:text-[#FF6B00] transition-all flex items-center justify-center gap-2"
                        >
                          <Plus size={14} /> 添加文案
                        </button>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold text-[#86868B] mb-2 uppercase">文字颜色</h4>
                      <div className="flex gap-2">
                        {['#FFFFFF', '#000000', analysis?.suggestedColor || '#FF6B00'].map(c => (
                          <button 
                            key={c}
                            onClick={() => setTextColor(c)}
                            style={{ backgroundColor: c }}
                            className={`w-8 h-8 rounded-full border-2 transition-all ${textColor === c ? 'border-[#FF6B00] scale-110' : 'border-[#E5E5E5]'}`}
                          />
                        ))}
                        <input 
                          type="color" 
                          value={textColor} 
                          onChange={(e) => setTextColor(e.target.value)}
                          className="w-8 h-8 rounded-full border-none p-0 overflow-hidden cursor-pointer bg-transparent"
                        />
                      </div>
                    </div>

                    <button 
                      onClick={handleDownload}
                      className="w-full py-4 bg-[#FF6B00] text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-[#E66000] active:scale-[0.98] transition-all shadow-lg shadow-[#FF6B00]/30"
                    >
                      <Download size={20} />
                      下载高清原图 (含文案)
                    </button>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
