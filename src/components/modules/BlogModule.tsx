import React, { useState } from "react";
import {
  BookOpen,
  Search,
  Filter,
  Plus,
  Edit2,
  Trash2,
  Sparkles,
  CheckCircle2,
  Clock,
  Send,
  Eye,
  X,
  ExternalLink
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { BlogPost, BlogPostStatus } from "../../types";

export const BlogModule: React.FC = () => {
  const { blogPosts, saveBlogPost, deleteBlogPost, currentUser, setCurrentView } = useAdminData();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedStatus, setSelectedStatus] = useState<string>("All");
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [aiTopicPrompt, setAiTopicPrompt] = useState("");
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);

  const categories = ["All", ...Array.from(new Set(blogPosts.map((b) => b.category)))];

  const filteredPosts = blogPosts.filter((post) => {
    const matchSearch =
      post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.excerpt.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.authorName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCategory = selectedCategory === "All" || post.category === selectedCategory;
    const matchStatus = selectedStatus === "All" || post.status === selectedStatus;
    return matchSearch && matchCategory && matchStatus;
  });

  const handleOpenNew = () => {
    const newP: BlogPost = {
      id: `post-${Date.now()}`,
      title: "",
      slug: "",
      excerpt: "",
      content: "",
      category: "Enterprise Software",
      tags: ["Enterprise", "Adaptive Systems"],
      authorName: currentUser.name,
      authorRole: currentUser.role,
      status: "draft",
      publishedAt: new Date().toISOString(),
      featuredImage: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&q=80",
      readingTimeMinutes: 5,
      seoTitle: "",
      metaDescription: "",
      updatedAt: new Date().toISOString(),
      viewsCount: 0
    };
    setEditingPost(newP);
    setAiTopicPrompt("");
    setIsEditModalOpen(true);
  };

  const handleGenerateWithAi = async () => {
    if (!aiTopicPrompt.trim()) return;
    setIsGeneratingAi(true);

    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "blog_post",
          prompt: `Write a high-caliber thought-leadership article for Artify Sols (artifysols.com) focusing on our core philosophy: 'Software should adapt your business, not your business adapt software.' Topic: ${aiTopicPrompt}`,
          context: {
            brandName: "Artify Sols",
            tone: "Visionary, architectural, and business-focused"
          }
        })
      });

      const data = await response.json();
      if (data && data.text) {
        // Parse generated output or set into editor
        const lines = data.text.split("\n");
        const titleCandidate = lines[0]?.replace(/^#*\s*/, "").trim() || aiTopicPrompt;
        const excerptCandidate = lines.find((l: string) => l.length > 40 && !l.startsWith("#")) || "Adaptive enterprise systems.";

        if (editingPost) {
          setEditingPost({
            ...editingPost,
            title: titleCandidate,
            slug: titleCandidate.toLowerCase().replace(/[^a-z0-9]/g, "-"),
            excerpt: excerptCandidate.slice(0, 180) + "...",
            content: data.text,
            readingTimeMinutes: Math.max(3, Math.round(data.text.split(" ").length / 200))
          });
        }
      }
    } catch (err) {
      console.error("AI generation failed:", err);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPost || !editingPost.title) return;
    const slug = editingPost.slug || editingPost.title.toLowerCase().replace(/[^a-z0-9]/g, "-");
    saveBlogPost({
      ...editingPost,
      slug
    });
    setIsEditModalOpen(false);
    setEditingPost(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-400" />
            <span>Blog, Thought Leadership & CMS</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Publish enterprise articles, architectural whitepapers, and customer case studies with Gemini AI co-piloting.
          </p>
        </div>
        <button
          onClick={handleOpenNew}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          <span>New CMS Article</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search posts, summaries, or authors..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                Category: {c}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
          >
            <option value="All">All Statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="in_review">In Review</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Posts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredPosts.map((post) => {
          const statusStyles: Record<BlogPostStatus, string> = {
            published: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
            draft: "bg-amber-500/10 text-amber-400 border-amber-500/30",
            in_review: "bg-purple-500/10 text-purple-400 border-purple-500/30",
            scheduled: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
            archived: "bg-slate-700 text-slate-400 border-slate-600"
          };

          return (
            <div
              key={post.id}
              className="rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition overflow-hidden flex flex-col justify-between group shadow-sm"
            >
              <div>
                <div className="h-40 relative overflow-hidden bg-slate-800">
                  <img
                    src={post.featuredImage}
                    alt={post.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                    referrerPolicy="no-referrer"
                  />
                  <span
                    className={`absolute top-3 right-3 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border backdrop-blur-md ${
                      statusStyles[post.status]
                    }`}
                  >
                    {post.status.replace("_", " ")}
                  </span>
                  <span className="absolute bottom-3 left-3 text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-950/80 text-cyan-300 border border-slate-800">
                    {post.category}
                  </span>
                </div>

                <div className="p-5">
                  <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition-colors line-clamp-2 mb-2">
                    {post.title}
                  </h3>
                  <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed mb-4">
                    {post.excerpt}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-3 border-t border-slate-800/80">
                    <span>By {post.authorName}</span>
                    <span>{post.readingTimeMinutes} min read</span>
                  </div>
                </div>
              </div>

              <div className="p-4 pt-0 flex items-center justify-between">
                <button
                  onClick={() => setCurrentView("public_website")}
                  className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
                >
                  <span>Preview</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingPost(post);
                      setIsEditModalOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit Post</span>
                  </button>
                  <button
                    onClick={() => deleteBlogPost(post.id)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit / Draft Modal */}
      {isEditModalOpen && editingPost && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 flex flex-col max-h-[90vh]"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">
                {editingPost.id.startsWith("post-new") || !editingPost.title
                  ? "Create Thought Leadership Post"
                  : `Edit: ${editingPost.title}`}
              </h3>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 overflow-y-auto flex-1 space-y-4 text-xs">
              {/* AI Co-pilot Box */}
              <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-800/40 space-y-2">
                <div className="flex items-center gap-2 text-purple-300 font-bold">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span>Gemini AI Content Drafting Co-pilot</span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Generate draft content framed through Artify's core positioning: "Software should adapt your business, not your business adapt software."
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter article concept e.g. Why modern ERPs fail without dynamic schema adaptation..."
                    value={aiTopicPrompt}
                    onChange={(e) => setAiTopicPrompt(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-purple-800/60 text-slate-100 placeholder-slate-500 text-xs focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={isGeneratingAi || !aiTopicPrompt.trim()}
                    onClick={handleGenerateWithAi}
                    className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold flex items-center gap-1.5 shrink-0"
                  >
                    {isGeneratingAi ? (
                      <span>Drafting...</span>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Generate with Gemini</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Title & Slug */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Post Title</label>
                  <input
                    type="text"
                    required
                    value={editingPost.title}
                    onChange={(e) => setEditingPost({ ...editingPost, title: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">URL Slug</label>
                  <input
                    type="text"
                    value={editingPost.slug}
                    onChange={(e) => setEditingPost({ ...editingPost, slug: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  />
                </div>
              </div>

              {/* Category & Status */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Category</label>
                  <input
                    type="text"
                    value={editingPost.category}
                    onChange={(e) => setEditingPost({ ...editingPost, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Publication Status</label>
                  <select
                    value={editingPost.status}
                    onChange={(e) =>
                      setEditingPost({
                        ...editingPost,
                        status: e.target.value as BlogPostStatus
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  >
                    <option value="draft">Draft</option>
                    <option value="in_review">In Review</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Reading Time (min)</label>
                  <input
                    type="number"
                    value={editingPost.readingTimeMinutes}
                    onChange={(e) =>
                      setEditingPost({ ...editingPost, readingTimeMinutes: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  />
                </div>
              </div>

              {/* Excerpt */}
              <div>
                <label className="block text-slate-400 mb-1">Excerpt / Summary</label>
                <textarea
                  rows={2}
                  value={editingPost.excerpt}
                  onChange={(e) => setEditingPost({ ...editingPost, excerpt: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              {/* Content */}
              <div>
                <label className="block text-slate-400 mb-1">Full Article Content (Markdown)</label>
                <textarea
                  rows={8}
                  value={editingPost.content}
                  onChange={(e) => setEditingPost({ ...editingPost, content: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md"
              >
                Save & Update CMS
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
