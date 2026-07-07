import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Upload, 
  RefreshCw, 
  Wand2, 
  MessageSquare,
  Sparkles,
  Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { chatAgent, ChatMessage, generateOneEcommerceImage, AnalysisResult, analyzeProductImage } from '../services/aiService';
import { compressImage } from '../utils';

interface AgentViewProps {
  saasInfo: { userId: string; toolId: string } | null;
  uploadedImage: string | null;
  setUploadedImage: (img: string | null) => void;
  onGenerationSuccess: (imageUrl: string, analysis: AnalysisResult, params: any) => void;
}

export default function AgentView({ saasInfo, uploadedImage, setUploadedImage, onGenerationSuccess }: AgentViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: '您好！我是您的 AI 视觉设计助手。您可以上传一张饮品产品图，我将为您分析并生成精美的电商大片。' }
  ]);
  const [suggestions, setSuggestions] = useState<string[]>(['上传产品图', '如何设计比较好？']);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState('现代简约');
  const [selectedPerspective, setSelectedPerspective] = useState('正面视角');
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, generating]);

  const handleSend = async (content: string) => {
    if (!content.trim() && !uploadedImage) return;

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    // Track parameters if they appear in content
    if (content.includes('现代') || content.includes('简约')) setSelectedStyle('现代简约');
    if (content.includes('奢华') || content.includes('高级')) setSelectedStyle('奢华高级');
    if (content.includes('模特') || content.includes('氛围')) setSelectedStyle('模特氛围');
    if (content.includes('特写')) setSelectedPerspective('特写视角');
    if (content.includes('正面') || content.includes('水平')) setSelectedPerspective('正面视角');

    try {
      const response = await chatAgent(newMessages, uploadedImage || undefined, saasInfo?.userId, saasInfo?.toolId);
      setMessages([...newMessages, { role: 'assistant', content: response.content }]);
      setSuggestions(response.suggestions || []);
      
      if (response.action === 'analyze' && uploadedImage) {
        handleAnalyze();
      } else if (response.action === 'generate' && uploadedImage) {
        handleQuickGenerate();
      }
    } catch (err) {
      console.error('Chat failed', err);
      setMessages([...newMessages, { role: 'assistant', content: '抱歉，我现在遇到了一点问题，请稍后再试。' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!uploadedImage) return;
    setLoading(true);
    try {
      const result = await analyzeProductImage(uploadedImage, saasInfo?.userId, saasInfo?.toolId);
      const sps = result.sellingPoints.map(sp => sp.text).join('、');
      
      // Instead of just setting messages, we "send" the analysis results to the AI 
      // so it can guide the user professionally.
      const analysisBrief = `系统分析结果：\n产品名称：${result.productName}\n核心卖点：${sps}\n建议色调：${result.suggestedColor}\n\n请确认以上文案是否可以直接使用？`;
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: analysisBrief
      }]);
      setSuggestions(['确认，下一步选择风格', '修改标题', '修改卖点']);
    } catch (err) {
      console.error('Analysis failed', err);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickGenerate = async () => {
    if (!uploadedImage) {
      setMessages(prev => [...prev, { role: 'assistant', content: '请先上传产品图片，以便我为您生成设计。' }]);
      return;
    }

    setGenerating(true);
    setMessages(prev => [...prev, { role: 'assistant', content: `正在为您生成“${selectedStyle}”风格的作品，请稍候...` }]);
    
    try {
      // Step 1: Analyze for text consistency
      const analysis = await analyzeProductImage(uploadedImage, saasInfo?.userId, saasInfo?.toolId);
      
      // Step 2: Generate image
      const imageUrl = await generateOneEcommerceImage(
        uploadedImage,
        selectedStyle,
        '1:1',
        '1K',
        selectedPerspective,
        saasInfo?.userId,
        saasInfo?.toolId
      );

      // Transition immediately
      onGenerationSuccess(imageUrl, analysis, { 
        style: selectedStyle, 
        perspective: selectedPerspective, 
        aspectRatio: '1:1', 
        resolution: '1K' 
      });
    } catch (err: any) {
      console.error('Quick generation failed', err);
      setMessages(prev => [...prev, { role: 'assistant', content: `生成失败了：${err.message}` }]);
    } finally {
      setGenerating(false);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressed = await compressImage(file);
        setUploadedImage(compressed);
        setMessages(prev => [...prev, { role: 'user', content: '我上传了一张图片，帮我看看怎么设计。' }]);
        handleSend('我上传了一张图片，帮我看看怎么设计。');
      } catch (err) {
        console.error('Upload failed', err);
      }
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (suggestion.includes('上传') || (suggestion.includes('图片') && !suggestion.includes('分析'))) {
      fileInputRef.current?.click();
    } else if (suggestion.includes('出图') || suggestion.includes('生成')) {
      handleQuickGenerate();
    } else if (suggestion.includes('分析')) {
      handleAnalyze();
    } else if (suggestion.includes('确认') || suggestion.includes('下一步')) {
      handleSend('文案确认无误，开始选择视觉风格');
    } else if (suggestion.includes('修改')) {
      handleSend(`我想修改${suggestion.replace('修改', '')}`);
    } else {
      // For styles or perspectives, we send it as a message to keep the flow
      handleSend(suggestion);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-[32px] border border-[#E5E5E5] shadow-xl overflow-hidden transition-all duration-500">
      {/* Header */}
      <div className="px-6 py-4 bg-[#F8F9FA] border-b border-[#E5E5E5] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#FF6B00] rounded-full flex items-center justify-center text-white shadow-lg shadow-[#FF6B00]/20">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-sm font-bold">智能体设计助手</h2>
            <p className="text-[10px] text-[#86868B] uppercase tracking-widest font-bold">Smart Design Agent</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-white border border-[#E5E5E5] rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-bold text-[#1D1D1F]">AI 在线</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
        <AnimatePresence initial={false}>
          {messages.map((msg, idx) => {
            const isLastMessage = idx === messages.length - 1;
            const showUploadButton = isLastMessage && msg.role === 'assistant' && !uploadedImage && !loading && !generating;

            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div className={`
                  max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm
                  ${msg.role === 'user' 
                    ? 'bg-[#1D1D1F] text-white rounded-tr-none' 
                    : 'bg-[#F5F5F7] text-[#1D1D1F] rounded-tl-none border border-[#E5E5E5]'}
                `}>
                  {msg.content}
                  
                  {/* Image preview for user uploads */}
                  {msg.role === 'user' && msg.content.includes('上传') && uploadedImage && (
                    <div className="mt-3 rounded-lg overflow-hidden border border-white/20 max-w-[180px]">
                      <img src={uploadedImage} alt="User Upload" className="w-full h-auto" />
                    </div>
                  )}
                </div>

                {/* Suggestions / Contextual Buttons below AI response */}
                {isLastMessage && msg.role === 'assistant' && !loading && !generating && suggestions.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 flex flex-wrap gap-2"
                  >
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleSuggestionClick(s)}
                        className={`
                          px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center gap-2
                          ${(s.includes('上传') || s.includes('出图') || s.includes('生成'))
                            ? 'bg-[#FF6B00] text-white shadow-lg shadow-[#FF6B00]/20' 
                            : 'bg-white text-[#1D1D1F] border border-[#E5E5E5] hover:border-[#FF6B00] hover:text-[#FF6B00]'}
                        `}
                      >
                        {(s.includes('上传') || s.includes('图片')) && <ImageIcon size={12} />}
                        {(s.includes('出图') || s.includes('生成')) && <Wand2 size={12} />}
                        {s}
                      </button>
                    ))}
                  </motion.div>
                )}
              </motion.div>
            );
          })}
          {loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
              <div className="bg-[#F5F5F7] p-4 rounded-2xl rounded-tl-none border border-[#E5E5E5] flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin text-[#FF6B00]" />
                <span className="text-xs text-[#86868B] font-medium">正在思考...</span>
              </div>
            </motion.div>
          )}
          {generating && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
              <div className="bg-[#FFF8F2] p-4 rounded-2xl rounded-tl-none border border-[#FF6B00]/20 flex items-center gap-3">
                <Wand2 size={16} className="animate-pulse text-[#FF6B00]" />
                <span className="text-xs text-[#FF6B00] font-bold">渲染视觉大片中...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={chatEndRef} />
      </div>

      {/* Input & Text Row */}
      <div className="p-6 bg-[#F8F9FA] border-t border-[#E5E5E5]">
        {/* Text Input */}
        <div className="relative flex items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={onFileChange}
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-3 bg-white border border-[#E5E5E5] rounded-xl text-[#86868B] hover:text-[#FF6B00] transition-colors shadow-sm"
          >
            <Upload size={20} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend(input)}
            placeholder="输入您的设计需求..."
            className="flex-1 bg-white border border-[#E5E5E5] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6B00]/20 focus:border-[#FF6B00] transition-all shadow-sm"
          />
          <button
            onClick={() => handleSend(input)}
            disabled={!input.trim() || loading}
            className="p-3 bg-[#1D1D1F] text-white rounded-xl hover:bg-[#2c2c2e] disabled:opacity-50 transition-all shadow-md active:scale-95"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
